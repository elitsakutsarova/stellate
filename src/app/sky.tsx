import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, View, Pressable, StyleSheet } from "react-native";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import { useKeepAwake } from "expo-keep-awake";
import { setLocation, setPresence } from "@/lib/api";
import { cancelSkyReminders, sendTestReminder } from "@/lib/notifications";
import { usePairStore } from "@/store/use-pair-store";
import { useLocation } from "@/hooks/use-location";
import { useSkyBodies, type SkyBody } from "@/hooks/use-sky-bodies";
import { useDeviceOrientation } from "@/hooks/use-device-orientation";
import { usePairPresence, type Looking } from "@/hooks/use-pair-presence";
import { useSkyReminders } from "@/hooks/use-sky-reminders";
import { useNotificationSettings } from "@/hooks/use-notification-settings";
import { useLookUpAlerts } from "@/hooks/use-look-up-alerts";
import { formatDuration, useTimeTogether } from "@/hooks/use-time-together";
import { SkyViewfinder } from "@/components/sky-viewfinder";
import { SkyScene } from "@/components/sky-scene";
import { FoundFlash, TogetherGlow } from "@/components/edge-glow";
import { MenuDivider, MenuHeading, MenuToggle, SideMenu } from "@/components/side-menu";
import { DebugMenu } from "@/components/debug-menu";
import { BottomSheet } from "@/components/bottom-sheet";
import { CodeRow } from "@/components/code-row";
import { Body, Button, MAX_TEXT_WIDTH, NightBackground, Pill, Title, WaitingLine } from "@/components/ui";
import { COLORS, fitScale } from "@/lib/theme";
import { directionTo } from "@/lib/geo";
import { skyColors, SKY_PRESETS, type SkyPreset } from "@/lib/sky-colors";

const NIGHT_UNTIL_KNOWN = -20;
const GLIDE_MS = 1200;
const PARTNER_NEARBY_KM = 20; // closer than this, a direction means little
const MAX_SKY_WAIT_MS = 4000; // show the sky anyway after this (e.g. a simulator has no sensors)
const SKY_FADE_MS = 500;

// Debug only: the moon's phases to cycle through (null = the real one tonight).
const DEBUG_PHASES = [
    null,
    { label: "new", fraction: 0.02, waxing: true },
    { label: "waxing crescent", fraction: 0.25, waxing: true },
    { label: "first quarter", fraction: 0.5, waxing: true },
    { label: "waxing gibbous", fraction: 0.8, waxing: true },
    { label: "full", fraction: 1, waxing: true },
    { label: "waning gibbous", fraction: 0.8, waxing: false },
    { label: "last quarter", fraction: 0.5, waxing: false },
    { label: "waning crescent", fraction: 0.25, waxing: false },
];

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
    // pointing at the sky means not touching the screen - don't let the phone lock
    useKeepAwake();

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

    const { bodies: realBodies, active: realActive } = useSkyBodies(coords);

    // Debug only: jump between times of day.
    const [debugSky, setDebugSky] = useState<SkyPreset | null>(null);
    const skyOrder: (SkyPreset | null)[] = [null, "day", "golden", "twilight", "night"];
    const nextDebugSky = skyOrder[(skyOrder.indexOf(debugSky) + 1) % skyOrder.length];
    const realSunAltitude = realBodies.find((b) => b.name === "sun")?.altitude;
    const sunAltitude = useGlide(__DEV__ && debugSky ? SKY_PRESETS[debugSky] : realSunAltitude) ?? NIGHT_UNTIL_KNOWN;

    // ...and show only the body that fits the preset (the moon at night/twilight, the
    // sun by day), placed where the higher of the two really is, so it's up to show off.
    const higher = realBodies.length > 0 ? realBodies.reduce((a, b) => (b.altitude > a.altitude ? b : a)) : null;
    const shownName = debugSky && SKY_PRESETS[debugSky] > 0 ? "sun" : "moon";
    const shownReal = realBodies.find((b) => b.name === shownName); // keeps the moon's phase
    const debugShown: SkyBody | null = __DEV__ && debugSky && higher && shownReal
        ? { ...shownReal, bearing: higher.bearing, altitude: higher.altitude, visible: higher.visible }
        : null;
    // Debug only: pretend it's another night in the moon's cycle.
    const [debugPhase, setDebugPhase] = useState(0);
    const phasePreset = __DEV__ ? DEBUG_PHASES[debugPhase] : null;
    const nextPhase = DEBUG_PHASES[(debugPhase + 1) % DEBUG_PHASES.length];
    const bodies = (debugShown ? [debugShown] : realBodies).map((b) =>
        b.phase && phasePreset ? { ...b, phase: { fraction: phasePreset.fraction, waxing: phasePreset.waxing } } : b);
    const active = debugShown ?? realActive;

    // Debug only: pretend the phone points straight at the sun or moon.
    const [debugTarget, setDebugTarget] = useState<Looking>(null);
    const debugBody = __DEV__ ? bodies.find((b) => b.name === debugTarget) : undefined;
    const nextDebugTarget: Looking = debugTarget === null ? "sun" : debugTarget === "sun" ? "moon" : null;

    const sensors = useDeviceOrientation(!!coords, debugBody ?? null);
    const { declination } = sensors;

    // The sky waits for the sensors' first readings and the location (or its error),
    // so it appears already in place instead of swinging there.
    const [skyReady, setSkyReady] = useState(false);
    useEffect(() => {
        if (sensors.ready && (coords || locationError)) setSkyReady(true);
    }, [sensors.ready, coords, locationError]);
    useEffect(() => {
        const timer = setTimeout(() => setSkyReady(true), MAX_SKY_WAIT_MS);
        return () => clearTimeout(timer);
    }, []);

    // the sky fades in over the "finding" message, which then goes
    const skyOpacity = useRef(new Animated.Value(0)).current;
    const [finding, setFinding] = useState(true);
    useEffect(() => {
        if (!skyReady) return;
        Animated.timing(skyOpacity, { toValue: 1, duration: SKY_FADE_MS, useNativeDriver: true }).start(() => setFinding(false));
    }, [skyReady, skyOpacity]);

    const palette = skyColors(sunAltitude);

    // which way your special someone is - not shown if they're right nearby
    const partnerLocation = partnerLeft ? null : pair?.partnerLocation;
    const partnerDirection = coords && partnerLocation ? directionTo(coords, partnerLocation) : null;
    const partner = partnerDirection && partnerDirection.km >= PARTNER_NEARBY_KM ? partnerDirection : null;

    const [myLooking, setMyLooking] = useState<Looking>(null);
    const handleLookingChange = useCallback((looking: Looking) => {
        setMyLooking(looking);
        setLooking(looking);
    }, [setLooking]);

    // both looking at the sky - the same body or not
    const together = !partnerLeft && !!myLooking && !!partnerLooking;
    const timeTogether = useTimeTogether(pairId, together);

    // While they look up, a line joins their light to the sky: to what you're looking at,
    // if you are (so together it lands on your sun/moon), otherwise to what they see.
    const link = partnerLooking ? { to: myLooking ?? partnerLooking, together } : null;

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

            {finding && (
                <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
                    <NightBackground glowY={0.5} />
                    <WaitingLine>Finding your sky...</WaitingLine>
                </View>
            )}

            <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { opacity: skyOpacity }]}>
                {skyReady && (
                    <>
                        <SkyScene
                            bodies={bodies} sunAltitude={sunAltitude} basis={sensors.basis} declination={declination}
                            partner={partner} link={link}
                        />
                        <SkyViewfinder bodies={bodies} active={active} basis={sensors.basis} declination={declination} onLookingChange={handleLookingChange} />
                    </>
                )}
            </Animated.View>
            <FoundFlash looking={myLooking} />
            <TogetherGlow visible={together} />

            {offline && (
                <View pointerEvents="none" style={{ position: "absolute", top: insets.top + 48, left: 0, right: 0, alignItems: "center", zIndex: 2 }}>
                    <Pill>Reconnecting...</Pill>
                </View>
            )}

            <DebugMenu
                top={insets.top + 8}
                items={[
                    ...(bodies.length > 0
                        ? [{ label: nextDebugTarget ? `Look at ${nextDebugTarget}` : "Use sensors", onPress: () => setDebugTarget(nextDebugTarget) }]
                        : []),
                    { label: `Sky: ${debugSky ?? "real"} -> ${nextDebugSky ?? "real"}`, onPress: () => setDebugSky(nextDebugSky) },
                    {
                        label: `Moon: ${phasePreset?.label ?? "real"} -> ${nextPhase?.label ?? "real"}`,
                        onPress: () => setDebugPhase((debugPhase + 1) % DEBUG_PHASES.length),
                    },
                    ...(notifications.supported
                        ? [{ label: "Test reminder in 10s", onPress: () => sendTestReminder(active?.name ?? "sun") }]
                        : []),
                ]}
            />

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
                {/* sections with a faint line and room between them */}
                <View style={{ gap: 24 }}>
                    {pair && (
                        <>
                            <View style={{ gap: 12 }}>
                                <MenuHeading color={palette.menuMuted}>Your connection</MenuHeading>
                                <CodeRow code={pair.code} size={20} accent={palette.menuAccent} />
                            </View>
                            <MenuDivider />
                        </>
                    )}

                    <View style={{ gap: 12 }}>
                        <MenuHeading color={palette.menuMuted}>Time together</MenuHeading>
                        <View style={{ gap: 4 }}>
                            <Title style={{ fontSize: 32, lineHeight: 38, color: palette.menuAccent }}>{formatDuration(timeTogether)}</Title>
                            <Body style={{ color: palette.menuMuted, fontSize: 13, lineHeight: 18 }}>
                                Counts while you both look up at the same time.
                            </Body>
                        </View>
                    </View>

                    <MenuDivider />

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
