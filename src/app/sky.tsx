import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, Alert } from "react-native";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { Share } from "react-native";
import * as Linking from "expo-linking";
import * as Haptics from "expo-haptics";
import { setPresence } from "@/lib/api";
import { usePairStore } from "@/store/use-pair-store";
import { useLocation } from "@/hooks/use-location";
import { useSkyBodies, basisLookingAt } from "@/hooks/use-sky-bodies";
import { useDeviceOrientation } from "@/hooks/use-device-orientation";
import { usePairPresence, type Looking } from "@/hooks/use-pair-presence";
import { SkyViewfinder } from "@/components/sky-viewfinder";
import { SkyScene } from "@/components/sky-scene";
import { TogetherGlow } from "@/components/together-glow";

// Light-on-dark text colours for the drawn night sky — placeholder styling
// until there's a real design for this screen.
const TEXT = {
    main: "#EEF0FF",
    muted: "#8C93B8",
    link: "#AFC3FF",
    online: "#9FE3D0",
    danger: "#F7A1A1",
    together: "#F7B7C8",
};

export default function Sky() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const deviceId = usePairStore((state) => state.deviceId);
    const pairId = usePairStore((state) => state.pairId);
    const isHydrated = usePairStore((state) => state.isHydrated);
    const clearPair = usePairStore((state) => state.clearPair);

    const { pair, partnerOnline, partnerLooking, partnerLeft, offline, setLooking } = usePairPresence(isHydrated, deviceId, pairId);

    const { coords, error: locationError, canAskAgain, retry } = useLocation();

    // Pops up whenever the error actually changes (e.g. first denied, or
    // switches from "denied" to "go to Settings") — not on every repeated
    // foreground re-check that still finds the same denial, since setting
    // state to an identical value doesn't trigger a re-render/effect.
    useEffect(() => {
        if (!locationError) return;
        Alert.alert("Location needed", locationError, [
            { text: "Not now", style: "cancel" },
            canAskAgain
                ? { text: "Try again", onPress: retry }
                : { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]);
    }, [locationError, canAskAgain, retry]);

    const { active } = useSkyBodies(coords);
    const sensors = useDeviceOrientation(!!coords);
    const { declination } = sensors;

    // Development only: pretend the phone is aimed straight at the sun/moon,
    // for testing on devices with poor sensors. __DEV__ is false in a real
    // build, so neither the button nor this override can exist there.
    const [debugLook, setDebugLook] = useState(false);
    const { E, N, U } = __DEV__ && debugLook && active
        ? basisLookingAt(active.bearing, active.altitude, declination)
        : sensors;

    // What *I'm* looking at, straight from the viewfinder (no delay) — the
    // other phone's value already arrives settled via presence.
    const [myLooking, setMyLooking] = useState<Looking>(null);
    const handleLookingChange = useCallback((looking: Looking) => {
        setMyLooking(looking);
        setLooking(looking);
    }, [setLooking]);

    // Both looking at the sky right now — the same body or not (it can be
    // day for one of you and night for the other).
    const together = !partnerLeft && !!myLooking && !!partnerLooking;

    // one gentle "success" buzz as the moment starts
    useEffect(() => {
        if (together) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, [together]);

    const handleDisconnect = async () => {
        if (pair && deviceId) {
            try {
                await setPresence(pair.id, deviceId, false);
            } catch (err: any) {
                // best-effort — still let them leave locally even if the
                // server couldn't be reached to update presence, so a
                // network hiccup can never trap someone on this screen
                console.warn("Couldn't update presence on disconnect:", err.message);
            }
        }
        await clearPair();
        router.replace("/");
    };

    const confirmDisconnect = () => {
        Alert.alert("Disconnect?", "You'll leave this connection. You can reconnect later with the same code.", [
            { text: "Cancel", style: "cancel" },
            { text: "Disconnect", style: "destructive", onPress: handleDisconnect },
        ]);
    };

    return (
        // Full screen (header hidden) so the drawn sky's maths, which uses the
        // window size, matches exactly what's on screen. Controls sit at the
        // bottom, leaving the middle of the screen for the sky.
        <View style={{ flex: 1, backgroundColor: "#0A0F2C" }}>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar style="light" />

            <SkyScene active={active} E={E} N={N} U={U} declination={declination} />
            <SkyViewfinder active={active} E={E} N={N} U={U} declination={declination} onLookingChange={handleLookingChange} />
            <TogetherGlow visible={together} />

            {__DEV__ && active && (
                <Pressable
                    onPress={() => setDebugLook((on) => !on)}
                    style={{ position: "absolute", top: insets.top + 48, right: 12, zIndex: 2, padding: 8, borderRadius: 8, backgroundColor: "#FFFFFF22" }}
                >
                    <Text style={{ fontSize: 12, color: TEXT.main }}>
                        {debugLook ? "Debug: sensors" : `Debug: look at ${active.name}`}
                    </Text>
                </Pressable>
            )}

            <View style={{ flex: 1, justifyContent: "flex-end", alignItems: "center", gap: 16, padding: 24, paddingBottom: insets.bottom + 24, zIndex: 2 }} pointerEvents="box-none">
                {locationError && (
                    <View style={{ alignItems: "center", gap: 8 }}>
                        <Text style={{ color: TEXT.danger, textAlign: "center" }}>{locationError}</Text>
                        <Pressable onPress={canAskAgain ? retry : () => Linking.openSettings()}>
                            <Text style={{ color: TEXT.link }}>{canAskAgain ? "Try again" : "Open Settings"}</Text>
                        </Pressable>
                    </View>
                )}

                {offline && (
                    <Text style={{ color: TEXT.muted }}>Can't reach the server, retrying…</Text>
                )}

                {partnerLeft && (
                    <View style={{ backgroundColor: "#FFFFFF1A", padding: 12, borderRadius: 10 }}>
                        <Text style={{ color: TEXT.main }}>Your special someone left this connection.</Text>
                    </View>
                )}
                {together && (
                    <View style={{ alignItems: "center", gap: 4 }}>
                        <Text style={{ color: TEXT.together, fontSize: 20, fontWeight: "600" }}>You are now connected</Text>
                        {/* <Text style={{ color: TEXT.muted, textAlign: "center" }}>
                            {myLooking === partnerLooking
                                ? `You're both looking at the ${myLooking}`
                                : `You: the ${myLooking} · Your special someone: the ${partnerLooking}`}
                        </Text> */}
                    </View>
                )}
                {!partnerLeft && !together && (
                    <Text style={{ color: partnerOnline ? TEXT.online : TEXT.muted, textAlign: "center" }}>
                        {partnerLooking
                            ? `● Your special someone is looking at the ${partnerLooking} right now`
                            : partnerOnline
                                ? "● Your special someone is here now"
                                : "○ Your special someone isn't in the app right now"}
                    </Text>
                )}

                {pair && (
                    <View style={{ alignItems: "center", gap: 6 }}>
                        <Text style={{ color: TEXT.muted }}>Room code</Text>
                        <Text style={{ fontSize: 24, fontWeight: "700", letterSpacing: 3, color: TEXT.main }}>{pair.code}</Text>
                        <View style={{ flexDirection: "row", gap: 16 }}>
                            <Pressable onPress={() => Clipboard.setStringAsync(pair.code)}>
                                <Text style={{ color: TEXT.link }}>Copy</Text>
                            </Pressable>
                            <Pressable onPress={() => Share.share({ message: `Join me on Stellate: ${pair.code}` })}>
                                <Text style={{ color: TEXT.link }}>Share</Text>
                            </Pressable>
                        </View>
                    </View>
                )}

                <Pressable onPress={confirmDisconnect}>
                    <Text style={{ color: TEXT.danger }}>Disconnect</Text>
                </Pressable>
            </View>
        </View>
    );
}
