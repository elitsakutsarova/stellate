import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import { setLocation, setPresence } from "@/lib/api";
import { cancelSkyReminders, sendTestReminder } from "@/lib/notifications";
import { usePairStore } from "@/store/use-pair-store";
import { useLocation } from "@/hooks/use-location";
import { useSkyBodies, basisLookingAt } from "@/hooks/use-sky-bodies";
import { useDeviceOrientation } from "@/hooks/use-device-orientation";
import { usePairPresence, type Looking } from "@/hooks/use-pair-presence";
import { useSkyReminders } from "@/hooks/use-sky-reminders";
import { useNotificationSettings } from "@/hooks/use-notification-settings";
import { useLookUpAlerts } from "@/hooks/use-look-up-alerts";
import { SkyViewfinder } from "@/components/sky-viewfinder";
import { SkyScene } from "@/components/sky-scene";
import { FoundFlash, TogetherGlow } from "@/components/edge-glow";
import { MenuHeading, MenuToggle, SideMenu } from "@/components/side-menu";
import { BottomSheet } from "@/components/bottom-sheet";
import { CodeRow } from "@/components/code-row";
import { Body, Button, MAX_TEXT_WIDTH, Pill, Title } from "@/components/ui";
import { COLORS, fitScale } from "@/lib/theme";

export default function Sky() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { width, height } = useSafeAreaFrame();
    // 1 on phones, bigger on tablets - the status card's size follows it
    const s = Math.max(1, fitScale(width, height));
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

    const notifications = useNotificationSettings();
    useSkyReminders(notifications.reminders, coords, partnerLeft ? null : pair?.partnerLocation ?? null);
    const [menuOpen, setMenuOpen] = useState(false);

    // The location sheet opens whenever the error actually changes (e.g. first
    // denied, or switches from "denied" to "go to Settings") - not on every
    // repeated foreground re-check that still finds the same denial, since
    // setting state to an identical value doesn't trigger this effect - and
    // closes by itself once location works.
    const [locationSheet, setLocationSheet] = useState(false);
    useEffect(() => {
        setLocationSheet(!!locationError);
    }, [locationError]);
    const fixLocation = () => {
        setLocationSheet(false);
        if (canAskAgain) retry();
        else Linking.openSettings();
    };

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

    // What *I'm* looking at, straight from the viewfinder (no delay) - the
    // other phone's value already arrives settled via presence.
    const [myLooking, setMyLooking] = useState<Looking>(null);
    const handleLookingChange = useCallback((looking: Looking) => {
        setMyLooking(looking);
        setLooking(looking);
    }, [setLooking]);

    // Both looking at the sky right now - the same body or not (it can be
    // day for one of you and night for the other).
    const together = !partnerLeft && !!myLooking && !!partnerLooking;

    useLookUpAlerts({ enabled: notifications.lookUp, pairId, deviceId, myLooking, partnerOnline });

    const handleDisconnect = async () => {
        if (pair && deviceId) {
            try {
                await setPresence(pair.id, deviceId, false);
            } catch (err: any) {
                // best-effort - still let them leave locally even if the
                // server couldn't be reached to update presence, so a
                // network hiccup can never trap someone on this screen
                console.warn("Couldn't update presence on disconnect:", err.message);
            }
        }
        await cancelSkyReminders(); // no reminders about someone you've left
        await clearPair();
        router.replace("/");
    };

    const [disconnectSheet, setDisconnectSheet] = useState(false);

    // The one line the status card shows (the together moment has its own).
    const status = partnerLeft
        ? { text: "Your special someone left this connection.", color: COLORS.muted }
        : partnerLooking
            ? { text: `● Your special someone is looking at the ${partnerLooking} right now`, color: COLORS.online }
            : partnerOnline
                ? { text: "● Your special someone is here now", color: COLORS.online }
                : { text: "○ Your special someone isn't in the app right now", color: COLORS.muted };

    return (
        // Full screen (header hidden) so the drawn sky's maths, which uses the
        // screen size, matches exactly what's on screen. The sky gets the whole
        // screen; everything else is kept small: a status card at the bottom,
        // the rest in the side menu.
        <View style={{ flex: 1, backgroundColor: COLORS.night }}>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar style="light" />

            <SkyScene bodies={bodies} E={E} N={N} U={U} declination={declination} />
            <SkyViewfinder bodies={bodies} active={active} E={E} N={N} U={U} declination={declination} onLookingChange={handleLookingChange} />
            <FoundFlash looking={myLooking} />
            <TogetherGlow visible={together} />

            {offline && (
                <View pointerEvents="none" style={{ position: "absolute", top: insets.top + 48, left: 0, right: 0, alignItems: "center", zIndex: 2 }}>
                    <Pill>Reconnecting...</Pill>
                </View>
            )}

            {__DEV__ && bodies.length > 0 && (
                <Pressable
                    onPress={() => setDebugTarget(nextDebugTarget)}
                    style={{ position: "absolute", top: insets.top + 84, right: 12, zIndex: 2 }}
                >
                    <Pill>{nextDebugTarget ? `Debug: look at ${nextDebugTarget}` : "Debug: sensors"}</Pill>
                </Pressable>
            )}

            {/* Status card: quiet on purpose - it hugs its text, with a faint
                glass look. Small on phones, scaled up (by s) on tablets. */}
            <View
                pointerEvents="box-none"
                style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + 20, paddingHorizontal: 24, alignItems: "center", zIndex: 2 }}
            >
                <View
                    style={{
                        maxWidth: MAX_TEXT_WIDTH * s, alignItems: "center", gap: 2 * s,
                        paddingVertical: 8 * s, paddingHorizontal: 16 * s,
                        borderRadius: together ? 20 * s : 999,
                        backgroundColor: "rgba(255, 255, 255, 0.05)",
                        borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.1)",
                    }}
                >
                    {together ? (
                        <>
                            <Title style={{ fontSize: 22 * s, lineHeight: 28 * s, color: COLORS.together, textAlign: "center" }}>
                                You are now connected
                            </Title>
                            <Body style={{ color: COLORS.muted, fontSize: 12 * s, lineHeight: 17 * s, textAlign: "center" }}>
                                {myLooking === partnerLooking
                                    ? `You're both looking at the ${myLooking}`
                                    : `You: the ${myLooking} · Your special someone: the ${partnerLooking}`}
                            </Body>
                        </>
                    ) : (
                        <Body style={{ color: status.color, fontSize: 13 * s, lineHeight: 18 * s, textAlign: "center" }}>{status.text}</Body>
                    )}
                    {locationError && !locationSheet && (
                        <Pressable onPress={() => setLocationSheet(true)} hitSlop={8}>
                            <Body style={{ color: COLORS.link, fontSize: 12 * s, lineHeight: 17 * s }}>Location is off - tap to fix</Body>
                        </Pressable>
                    )}
                </View>
            </View>

            <SideMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <View style={{ gap: 36 }}>
                    {pair && (
                        <View style={{ gap: 12 }}>
                            <MenuHeading>Your connection</MenuHeading>
                            <CodeRow code={pair.code} size={20} />
                        </View>
                    )}

                    <View style={{ gap: 16 }}>
                        <MenuHeading>Notifications</MenuHeading>
                        <MenuToggle
                            label="When your special someone looks up"
                            value={notifications.lookUp}
                            onChange={(on) => notifications.toggle("lookUp", on)}
                            disabled={!notifications.supported}
                        />
                        <MenuToggle
                            label="When the sun or moon is up for both of you"
                            value={notifications.reminders}
                            onChange={(on) => notifications.toggle("reminders", on)}
                            disabled={!notifications.supported}
                        />
                        {!notifications.supported && (
                            <Body style={{ color: COLORS.muted, fontSize: 13, lineHeight: 18 }}>
                                Not available in Expo Go on Android - needs a development build.
                            </Body>
                        )}
                        {__DEV__ && notifications.supported && (
                            <Pressable onPress={sendTestReminder}>
                                <Body style={{ color: COLORS.link, fontSize: 14 }}>Debug: test reminder in 10s</Body>
                            </Pressable>
                        )}
                    </View>
                </View>

                <Button
                    label="Disconnect" variant="danger"
                    onPress={() => {
                        setMenuOpen(false);
                        setDisconnectSheet(true);
                    }}
                />
            </SideMenu>

            <BottomSheet open={locationSheet} onClose={() => setLocationSheet(false)}>
                <Title style={{ fontSize: 32, lineHeight: 38 }}>Location needed</Title>
                <Body style={{ color: COLORS.muted }}>
                    {canAskAgain
                        ? "Stellate uses your location to find where the sun and moon are in your sky."
                        : "Location is off for Stellate. Turn it on in Settings to find the sun and moon in your sky."}
                </Body>
                <View style={{ gap: 12 }}>
                    <Button label={canAskAgain ? "Allow location" : "Open Settings"} onPress={fixLocation} />
                    <Button label="Not now" variant="glass" onPress={() => setLocationSheet(false)} />
                </View>
            </BottomSheet>

            <BottomSheet open={disconnectSheet} onClose={() => setDisconnectSheet(false)}>
                <Title style={{ fontSize: 32, lineHeight: 38 }}>Leave this connection?</Title>
                <Body style={{ color: COLORS.muted }}>You can reconnect later with the same code.</Body>
                <View style={{ gap: 12 }}>
                    <Button label="Disconnect" variant="danger" onPress={handleDisconnect} />
                    <Button label="Cancel" variant="glass" onPress={() => setDisconnectSheet(false)} />
                </View>
            </BottomSheet>
        </View>
    );
}
