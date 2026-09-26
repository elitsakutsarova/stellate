import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, Alert, Switch } from "react-native";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { Share } from "react-native";
import * as Linking from "expo-linking";
import { setLocation, setPresence } from "@/lib/api";
import { cancelSkyReminders, sendTestReminder } from "@/lib/sky-reminders";
import { usePairStore } from "@/store/use-pair-store";
import { useLocation } from "@/hooks/use-location";
import { useSkyBodies, basisLookingAt } from "@/hooks/use-sky-bodies";
import { useDeviceOrientation } from "@/hooks/use-device-orientation";
import { usePairPresence, type Looking } from "@/hooks/use-pair-presence";
import { useSkyReminders } from "@/hooks/use-sky-reminders";
import { SkyViewfinder } from "@/components/sky-viewfinder";
import { SkyScene } from "@/components/sky-scene";
import { FoundFlash, TogetherGlow } from "@/components/edge-glow";
import { SideMenu } from "@/components/side-menu";

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

    // Share a rough location (the server rounds it to ~10 km) so the other
    // phone can plan "moon is up for both of you" reminders. Best-effort: if
    // it fails, reminders just wait until the next time.
    useEffect(() => {
        if (!coords || !pairId || !deviceId) return;
        setLocation(pairId, deviceId, coords).catch(() => {});
    }, [coords, pairId, deviceId]);

    const reminders = useSkyReminders(coords, partnerLeft ? null : pair?.partnerLocation ?? null);
    const [menuOpen, setMenuOpen] = useState(false);

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

    const { bodies, active } = useSkyBodies(coords);
    const sensors = useDeviceOrientation(!!coords);
    const { declination } = sensors;

    // Development only: pretend the phone is aimed straight at the sun/moon,
    // for testing on devices with poor sensors. __DEV__ is false in a real
    // build, so neither the button nor this override can exist there.
    // Tapping cycles: sensors -> look at sun -> look at moon -> sensors.
    const [debugTarget, setDebugTarget] = useState<Looking>(null);
    const debugBody = __DEV__ ? bodies.find((b) => b.name === debugTarget) : undefined;
    const { E, N, U } = debugBody
        ? basisLookingAt(debugBody.bearing, debugBody.altitude, declination)
        : sensors;
    const nextDebugTarget: Looking = debugTarget === null ? "sun" : debugTarget === "sun" ? "moon" : null;

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
        await cancelSkyReminders(); // no reminders about someone you've left
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

            <SkyScene bodies={bodies} E={E} N={N} U={U} declination={declination} />
            <SkyViewfinder bodies={bodies} active={active} E={E} N={N} U={U} declination={declination} onLookingChange={handleLookingChange} />
            <FoundFlash looking={myLooking} />
            <TogetherGlow visible={together} />

            {__DEV__ && bodies.length > 0 && (
                <Pressable
                    onPress={() => setDebugTarget(nextDebugTarget)}
                    style={{ position: "absolute", top: insets.top + 48, right: 12, zIndex: 2, padding: 8, borderRadius: 8, backgroundColor: "#FFFFFF22" }}
                >
                    <Text style={{ fontSize: 12, color: TEXT.main }}>
                        {nextDebugTarget ? `Debug: look at ${nextDebugTarget}` : "Debug: sensors"}
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
                        <Text style={{ color: TEXT.muted, textAlign: "center" }}>
                            {myLooking === partnerLooking
                                ? `You're both looking at the ${myLooking}`
                                : `You: the ${myLooking} · Your special someone: the ${partnerLooking}`}
                        </Text>
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

            <SideMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <View style={{ gap: 6 }}>
                    {/* The whole row is the button; the switch only *shows* the
                        state (no touches of its own), so it can't flip on
                        and back off while the permission is still being
                        decided — it only moves once the answer is known. */}
                    <Pressable
                        onPress={() => reminders.toggle(!reminders.enabled)}
                        disabled={!reminders.supported}
                        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}
                    >
                        <Text style={{ color: TEXT.main, fontSize: 16, flex: 1 }}>Sky reminders</Text>
                        <View pointerEvents="none">
                            <Switch value={reminders.enabled} disabled={!reminders.supported} />
                        </View>
                    </Pressable>
                    <Text style={{ color: TEXT.muted, fontSize: 13 }}>
                        A notification when the sun or moon is up for both of you.
                    </Text>
                    {!reminders.supported && (
                        <Text style={{ color: TEXT.muted, fontSize: 13 }}>
                            Not available in Expo Go on Android — needs a development build.
                        </Text>
                    )}
                </View>

                {__DEV__ && reminders.supported && (
                    <Pressable onPress={sendTestReminder}>
                        <Text style={{ color: TEXT.link }}>Debug: test reminder in 10s</Text>
                    </Pressable>
                )}
            </SideMenu>
        </View>
    );
}
