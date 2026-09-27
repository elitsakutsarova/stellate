import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, View, Text, Pressable } from "react-native";
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
import { skyColors, SKY_PRESETS, type SkyPreset } from "@/lib/sky-colors";

const NIGHT_UNTIL_KNOWN = -20;
const GLIDE_MS = 1200;

// Eases towards `target` instead of jumping, so the sky's colours change smoothly.
// The first known value is taken straight away.
function useGlide(target: number | undefined) {
    const anim = useRef(new Animated.Value(target ?? 0)).current; // starts where the target is
    const [value, setValue] = useState<number | undefined>(target);
    const started = useRef(target !== undefined);

    useEffect(() => {
        const id = anim.addListener(({ value }) => setValue(value));
        return () => anim.removeListener(id);
    }, [anim]);

    useEffect(() => {
        if (target === undefined) return;
        if (!started.current) {
            started.current = true;
            anim.setValue(target);
            return;
        }
        Animated.timing(anim, { toValue: target, duration: GLIDE_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start();
    }, [target, anim]);

    return value;
}

export default function Sky() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { width, height } = useSafeAreaFrame();
    const s = Math.max(1, fitScale(width, height));
    const deviceId = usePairStore((state) => state.deviceId);
    const pairId = usePairStore((state) => state.pairId);
    const isHydrated = usePairStore((state) => state.isHydrated);
    const clearPair = usePairStore((state) => state.clearPair);

    const { pair, partnerOnline, partnerLooking, partnerLeft, offline, setLooking } = usePairPresence(isHydrated, deviceId, pairId);

    const { coords, error: locationError, canAskAgain, retry } = useLocation();

    // rough location (the server rounds it) for the other phone's reminders
    useEffect(() => {
        if (!coords || !pairId || !deviceId) return;
        setLocation(pairId, deviceId, coords).catch(() => {});
    }, [coords, pairId, deviceId]);

    const notifications = useNotificationSettings();
    useSkyReminders(notifications.reminders, coords, partnerLeft ? null : pair?.partnerLocation ?? null);
    const [menuOpen, setMenuOpen] = useState(false);

    // opens when the error changes, closes once location works
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

    // Debug only: pretend the phone points straight at the sun or moon.
    const [debugTarget, setDebugTarget] = useState<Looking>(null);
    const debugBody = __DEV__ ? bodies.find((b) => b.name === debugTarget) : undefined;
    const { E, N, U } = debugBody
        ? basisLookingAt(debugBody.bearing, debugBody.altitude, declination)
        : sensors;
    const nextDebugTarget: Looking = debugTarget === null ? "sun" : debugTarget === "sun" ? "moon" : null;

    // Debug only: jump between times of day.
    const [debugSky, setDebugSky] = useState<SkyPreset | null>(null);
    const skyOrder: (SkyPreset | null)[] = [null, "day", "golden", "twilight", "night"];
    const nextDebugSky = skyOrder[(skyOrder.indexOf(debugSky) + 1) % skyOrder.length];
    const realSunAltitude = bodies.find((b) => b.name === "sun")?.altitude;
    const sunAltitude = useGlide(__DEV__ && debugSky ? SKY_PRESETS[debugSky] : realSunAltitude) ?? NIGHT_UNTIL_KNOWN;
    const palette = skyColors(sunAltitude);

    const [myLooking, setMyLooking] = useState<Looking>(null);
    const handleLookingChange = useCallback((looking: Looking) => {
        setMyLooking(looking);
        setLooking(looking);
    }, [setLooking]);

    // both looking at the sky - the same body or not
    const together = !partnerLeft && !!myLooking && !!partnerLooking;

    useLookUpAlerts({ enabled: notifications.lookUp, pairId, deviceId, myLooking, partnerOnline });

    const handleDisconnect = async () => {
        if (pair && deviceId) {
            try {
                await setPresence(pair.id, deviceId, false);
            } catch (err: any) {
                // leave locally even if the server can't be reached
                console.warn("Couldn't update presence on disconnect:", err.message);
            }
        }
        await cancelSkyReminders(); // no reminders about someone you've left
        await clearPair();
        router.replace("/");
    };

    const [disconnectSheet, setDisconnectSheet] = useState(false);

    const status = partnerLeft
        ? { text: "Your special someone left this connection.", color: COLORS.muted }
        : partnerLooking
            ? { text: `● Your special someone is looking at the ${partnerLooking} right now`, color: COLORS.online }
            : partnerOnline
                ? { text: "● Your special someone is here now", color: COLORS.online }
                : { text: "○ Your special someone isn't in the app right now", color: COLORS.muted };

    return (
        // full screen (header hidden) so the sky maths match the screen
        <View style={{ flex: 1, backgroundColor: COLORS.night }}>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar style="light" />

            <SkyScene bodies={bodies} sunAltitude={sunAltitude} E={E} N={N} U={U} declination={declination} />
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
            {__DEV__ && (
                <Pressable
                    onPress={() => setDebugSky(nextDebugSky)}
                    style={{ position: "absolute", top: insets.top + 120, right: 12, zIndex: 2 }}
                >
                    <Pill>{`Debug sky: ${debugSky ?? "real"} -> ${nextDebugSky ?? "real"}`}</Pill>
                </Pressable>
            )}

            {/* status card */}
            <View
                pointerEvents="box-none"
                style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + 20, paddingHorizontal: 24, alignItems: "center", zIndex: 2 }}
            >
                <View
                    style={{
                        maxWidth: MAX_TEXT_WIDTH * s, alignItems: "center", gap: 2 * s,
                        paddingVertical: 8 * s, paddingHorizontal: 16 * s,
                        borderRadius: together ? 20 * s : 999,
                        backgroundColor: palette.card, // white glass at night, smoked glass by day
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

            <SideMenu open={menuOpen} onOpenChange={setMenuOpen} background={palette.surface}>
                <View style={{ gap: 36 }}>
                    {pair && (
                        <View style={{ gap: 12 }}>
                            <MenuHeading color={palette.menuMuted}>Your connection</MenuHeading>
                            <CodeRow code={pair.code} size={20} accent={palette.menuAccent} />
                        </View>
                    )}

                    <View style={{ gap: 16 }}>
                        <MenuHeading color={palette.menuMuted}>Notifications</MenuHeading>
                        <MenuToggle
                            label="When your special someone looks up"
                            value={notifications.lookUp}
                            onChange={(on) => notifications.toggle("lookUp", on)}
                            disabled={!notifications.supported}
                            accent={palette.menuAccent}
                        />
                        <MenuToggle
                            label="When the sun or moon is up for both of you"
                            value={notifications.reminders}
                            onChange={(on) => notifications.toggle("reminders", on)}
                            disabled={!notifications.supported}
                            accent={palette.menuAccent}
                        />
                        {!notifications.supported && (
                            <Body style={{ color: palette.menuMuted, fontSize: 13, lineHeight: 18 }}>
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

            <BottomSheet open={locationSheet} onClose={() => setLocationSheet(false)} background={palette.surface}>
                <Title style={{ fontSize: 32, lineHeight: 38 }}>Location needed</Title>
                <Body style={{ color: COLORS.muted }}>
                    {canAskAgain
                        ? "Stellate uses your location to find where the sun and moon are in your sky."
                        : "Location is off for Stellate. Turn it on in Settings to find the sun and moon in your sky."}
                </Body>
                <View style={{ gap: 4 }}>
                    <Button label={canAskAgain ? "Allow location" : "Open Settings"} onPress={fixLocation} />
                    <Button label="Not now" variant="ghost" onPress={() => setLocationSheet(false)} />
                </View>
            </BottomSheet>

            <BottomSheet open={disconnectSheet} onClose={() => setDisconnectSheet(false)} background={palette.surface}>
                <Title style={{ fontSize: 32, lineHeight: 38 }}>Leave this connection?</Title>
                <Body style={{ color: COLORS.muted }}>You can reconnect later with the same code.</Body>
                <View style={{ gap: 4 }}>
                    <Button label="Disconnect" variant="danger" onPress={handleDisconnect} />
                    <Button label="Cancel" variant="ghost" onPress={() => setDisconnectSheet(false)} />
                </View>
            </BottomSheet>
        </View>
    );
}
