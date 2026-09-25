import { useEffect, useState } from "react";
import { View, Text, Pressable, Alert } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { Share } from "react-native";
import { supabase } from "@/lib/supabase";
import { useDeviceId } from "@/hooks/use-device-id";
import { PAIR_ID_KEY, PAIR_CODE_KEY } from "@/lib/constants";
import * as Haptics from "expo-haptics";
import { useLocation } from "@/hooks/use-location";
import { useSkyBodies } from "@/hooks/use-sky-bodies";
import { useRef } from "react";
import { useWindowDimensions } from "react-native";
import { useDeviceOrientation } from "@/hooks/use-device-orientation";
import { projectToScreen } from "@/hooks/use-sky-bodies";

export default function Sky() {
    const router = useRouter();
    const { deviceId } = useDeviceId();
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

    useEffect(() => {
        if (isAligned && !wasAligned.current) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        wasAligned.current = isAligned;
    }, [isAligned]);


    useEffect(() => {
        if (!deviceId) return;

        let rowChannel: any;
        let presenceChannel: any;
        let cancelled = false;

        (async () => {
            const pairId = await AsyncStorage.getItem(PAIR_ID_KEY);
            if (!pairId) { router.replace("/"); return; }

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
    }, [deviceId]);

    // done - um try to make the function update status automatically (without reload) if someone has disconnected and reconnected
    async function handleDisconnect() {
        if (pair && deviceId) {
            const amI_A = pair.device_a === deviceId;
            await supabase
                .from("pairs")
                .update(amI_A ? { device_a_active: false } : { device_b_active: false })
                .eq("id", pair.id);
        }
        await AsyncStorage.removeItem(PAIR_ID_KEY);
        await AsyncStorage.removeItem(PAIR_CODE_KEY);
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
                <View
                    style={{
                        position: "absolute",
                        left: projection.arrowX - 16,
                        top: projection.arrowY - 16,
                        transform: [{ rotate: `${projection.arrowDeg}deg` }],
                    }}
                >
                    <Text style={{ fontSize: 32, color: "#888" }}>▲</Text>
                </View>
            )}
            {projection?.visible && (
                <View style={{ position: "absolute", left: projection.x - 24, top: projection.y - 24, zIndex: 10 }}>
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