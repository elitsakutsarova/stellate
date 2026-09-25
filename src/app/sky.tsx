import { useEffect, useState } from "react";
import { View, Text, Pressable, Alert } from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Share } from "react-native";
import { supabase } from "@/lib/supabase";
import { usePairStore } from "@/store/use-pair-store";
import * as Haptics from "expo-haptics";
import { useLocation } from "@/hooks/use-location";
import { useSkyBodies } from "@/hooks/use-sky-bodies";
import { useRef } from "react";
import { useWindowDimensions } from "react-native";
import { useDeviceOrientation } from "@/hooks/use-device-orientation";
import { projectToScreen } from "@/hooks/use-sky-bodies";

export default function Sky() {
    const router = useRouter();
    const deviceId = usePairStore((state) => state.deviceId);
    const pairId = usePairStore((state) => state.pairId);
    const isHydrated = usePairStore((state) => state.isHydrated);
    const clearPair = usePairStore((state) => state.clearPair);
    const [pair, setPair] = useState<any>(null);
    const [partnerOnline, setPartnerOnline] = useState(false);
    const [partnerLeft, setPartnerLeft] = useState(false);

    const { coords, error: locationError, retry } = useLocation();
    const { active } = useSkyBodies(coords);
    const { width, height } = useWindowDimensions();
    const { E, N, U, declination } = useDeviceOrientation();
    const projection = active
        ? projectToScreen(E, N, U, declination, active.bearing, active.altitude, width, height)
        : null;

    const isAligned = projection ? projection.visible && projection.angleFromCenter < 8 : false;
    const wasAligned = useRef(false);
    const iconRef = useRef<View | null>(null);
    const arrowRef = useRef<View | null>(null);
    // Kept in sync every render (not via an effect) so the animation loop
    // below can always read the latest projection without needing to
    // restart — projection is a new object every render, so depending on
    // it directly would tear down and reset the loop on every sensor tick.
    const projectionRef = useRef(projection);
    projectionRef.current = projection;
    const targetPos = useRef({ x: projection?.x ?? 0, y: projection?.y ?? 0 });
    const arrowState = useRef({
        x: projection?.arrowX ?? 0,
        y: projection?.arrowY ?? 0,
        deg: projection?.arrowDeg ?? 0,
    });

    useEffect(() => {
        let animationFrame: number;
        function loop() {
            animationFrame = requestAnimationFrame(loop);
            const p = projectionRef.current;
            targetPos.current.x += ((p?.x ?? targetPos.current.x) - targetPos.current.x) * 0.1;
            targetPos.current.y += ((p?.y ?? targetPos.current.y) - targetPos.current.y) * 0.1;
            iconRef.current?.setNativeProps({
                style: {
                    left: targetPos.current.x - 24,
                    top: targetPos.current.y - 24,
                    transform: [{ rotate: `${p?.iconRotation ?? 0}deg` }],
                },
            });

            if (p) {
                arrowState.current.x += (p.arrowX - arrowState.current.x) * 0.1;
                arrowState.current.y += (p.arrowY - arrowState.current.y) * 0.1;
                // shortest-path angle smoothing, so crossing the 0°/360°
                // wrap doesn't make the arrow spin the long way around
                const deltaDeg = ((p.arrowDeg - arrowState.current.deg + 540) % 360) - 180;
                arrowState.current.deg += deltaDeg * 0.1;
            }
            arrowRef.current?.setNativeProps({
                style: {
                    left: arrowState.current.x - 16,
                    top: arrowState.current.y - 16,
                    transform: [{ rotate: `${arrowState.current.deg}deg` }],
                },
            });
        }
        loop();
        return () => cancelAnimationFrame(animationFrame);
    }, []);

    useEffect(() => {
        if (isAligned && !wasAligned.current) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        wasAligned.current = isAligned;
    }, [isAligned]);


    useEffect(() => {
        if (!isHydrated) return;
        if (!deviceId || !pairId) { router.replace("/"); return; }

        let rowChannel: any;
        let presenceChannel: any;
        let cancelled = false;

        (async () => {
            const { data } = await supabase.from("pairs").select("*").eq("id", pairId).single();
            if (!data || cancelled) { router.replace("/"); return; }
            setPair(data);

            const amI_A = data.device_a === deviceId;
            setPartnerLeft(!(amI_A ? data.device_b_active : data.device_a_active));

            rowChannel = supabase
                .channel(`pair-row-${pairId}`)
                .on(
                    "postgres_changes",
                    { event: "UPDATE", schema: "public", table: "pairs", filter: `id=eq.${pairId}` },
                    (payload) => {
                        const updated = payload.new as any;
                        setPartnerLeft(!(amI_A ? updated.device_b_active : updated.device_a_active));
                    }
                )
                .subscribe();

            presenceChannel = supabase.channel(`pair-presence-${pairId}`, {
                config: { presence: { key: deviceId } },
            });
            presenceChannel
                .on("presence", { event: "sync" }, () => {
                    const state = presenceChannel.presenceState();
                    const others = Object.keys(state).filter((k) => k !== deviceId);
                    setPartnerOnline(others.length > 0);
                })
                .subscribe(async (status: string) => {
                    if (status === "SUBSCRIBED") await presenceChannel.track({ online: true });
                });
        })();

        return () => {
            cancelled = true;
            if (rowChannel) supabase.removeChannel(rowChannel);
            if (presenceChannel) supabase.removeChannel(presenceChannel);
        };
    }, [isHydrated, deviceId, pairId]);

    // done - um try to make the function update status automatically (without reload) if someone has disconnected and reconnected
    async function handleDisconnect() {
        if (pair && deviceId) {
            const amI_A = pair.device_a === deviceId;
            await supabase
                .from("pairs")
                .update(amI_A ? { device_a_active: false } : { device_b_active: false })
                .eq("id", pair.id);
        }
        await clearPair();
        router.replace("/");
    }

    function confirmDisconnect() {
        Alert.alert("Disconnect?", "You'll leave this connection. You can reconnect later with the same code.", [
            { text: "Cancel", style: "cancel" },
            { text: "Disconnect", style: "destructive", onPress: handleDisconnect },
        ]);
    }

    return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 20, padding: 24 }}>
            {locationError && (
                <View style={{ alignItems: "center", gap: 8 }}>
                    <Text style={{ color: "#e63946" }}>{locationError}</Text>
                    <Pressable onPress={retry}>
                        <Text style={{ color: "#457b9d" }}>Try again</Text>
                    </Pressable>
                </View>
            )}

            {active && (
                // Spans the full screen explicitly — the parent's alignItems:
                // "center" would otherwise shrink a flex:1 child to its content
                // width, throwing off projection.x/y (computed from the actual
                // screen width/height) and making the icon land somewhere
                // that doesn't match where it's supposed to be.
                <View
                    pointerEvents="box-none"
                    style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }}
                >
                    {/* temporary debug readout — remove once this locks on reliably */}
                    <Text style={{ position: "absolute", top: 8, left: 12, color: "#888", fontSize: 12 }}>
                        {active.name} target az {active.bearing.toFixed(0)}° alt {active.altitude.toFixed(0)}°{"\n"}
                        diff {projection?.angleFromCenter.toFixed(0)}° · declination {declination.toFixed(0)}°
                    </Text>
                    {projection && (
                        <Text style={{ position: "absolute", bottom: 40, alignSelf: "center", color: "#888" }}>
                            Turn your phone to look around
                        </Text>
                    )}
                    {projection && !projection.visible && (
                        <View ref={arrowRef} style={{ position: "absolute" }}>
                            <Text style={{ fontSize: 32, color: "#888" }}>▲</Text>
                        </View>
                    )}
                    {projection?.visible && (
                        <View ref={iconRef} style={{ position: "absolute", zIndex: 10 }}>
                            <Text style={{ fontSize: 48 }}>
                                {active?.name === "sun" ? "☀️" : "🌙"}
                            </Text>
                        </View>
                    )}
                </View>
            )}

            {partnerLeft && (
                <View style={{ backgroundColor: "#f4a26140", padding: 12, borderRadius: 10 }}>
                    <Text>Your partner left this connection.</Text>
                </View>
            )}
            {!partnerLeft && (
                <Text style={{ color: partnerOnline ? "#2a9d8f" : "#888" }}>
                    {partnerOnline ? "● Partner is here now" : "○ Partner isn't in the app right now"}
                </Text>
            )}

            {pair && (
                <View style={{ alignItems: "center", gap: 8 }}>
                    <Text style={{ color: "#888" }}>Room code</Text>
                    <Text style={{ fontSize: 24, fontWeight: "700", letterSpacing: 3 }}>{pair.code}</Text>
                    <View style={{ flexDirection: "row", gap: 16 }}>
                        <Pressable onPress={() => Clipboard.setStringAsync(pair.code)}>
                            <Text style={{ color: "#457b9d" }}>Copy</Text>
                        </Pressable>
                        <Pressable onPress={() => Share.share({ message: `Join me on Stellate: ${pair.code}` })}>
                            <Text style={{ color: "#457b9d" }}>Share</Text>
                        </Pressable>
                    </View>
                </View>
            )}

            <Pressable onPress={confirmDisconnect}>
                <Text style={{ color: "#e63946" }}>Disconnect</Text>
            </Pressable>
        </View>
    );
}
// !!! this disconnect button only disconnects device that triggered it from the pair, but the other connected device is still connected - need to find a way to show them sth like "aw man your soulmate disconnected" - maybe also if it was an accident it can have a reconnect code
// also in table the pair still shows the disconnected device - e.g device_a pressed disconnect => still in Supabase table