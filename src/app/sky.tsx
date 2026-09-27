import { useEffect, useRef, useState } from "react";
import { Animated, Linking, View, Pressable, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeepAwake } from "expo-keep-awake";
import { setLocation, setPresence } from "@/lib/api";
import { cancelSkyReminders, sendTestReminder } from "@/lib/notifications";
import { usePairStore } from "@/store/use-pair-store";
import { useLocation } from "@/hooks/use-location";
import { useSkyBodies } from "@/hooks/use-sky-bodies";
import { useSkyDebug } from "@/hooks/use-sky-debug";
import { useGlide } from "@/hooks/use-glide";
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
import { skyColors } from "@/lib/sky-colors";

const NIGHT_UNTIL_KNOWN = -20;
const PARTNER_NEARBY_KM = 20;
const MAX_SKY_WAIT_MS = 4000;
const SKY_FADE_MS = 500;

export default function Sky() {
    const insets = useSafeAreaInsets();
    const { width, height } = useSafeAreaFrame();
    const s = Math.max(1, fitScale(width, height));
    const deviceId = usePairStore((state) => state.deviceId);
    const pairId = usePairStore((state) => state.pairId);
    const clearPair = usePairStore((state) => state.clearPair);
    useKeepAwake();

    const { pair, partnerOnline, partnerLooking, partnerLeft, offline, setLooking } = usePairPresence(deviceId, pairId);

    const { coords, error: locationError, canAskAgain, retry } = useLocation();

    // rough location (the server rounds it) for the other phone
    useEffect(() => {
        if (!coords || !pairId || !deviceId) return;
        setLocation(pairId, deviceId, coords).catch(() => {});
    }, [coords, pairId, deviceId]);

    const notifications = useNotificationSettings();
    useSkyReminders(notifications.reminders, coords, partnerLeft ? null : pair?.partnerLocation ?? null);
    const [menuOpen, setMenuOpen] = useState(false);

    const [closedError, setClosedError] = useState<string | null>(null);
    const locationSheet = !!locationError && closedError !== locationError;
    const closeLocationSheet = () => setClosedError(locationError);
    const fixLocation = () => {
        closeLocationSheet();
        if (canAskAgain) retry();
        else Linking.openSettings();
    };

    const real = useSkyBodies(coords);
    const debug = useSkyDebug(real.bodies, real.active);
    const { bodies, active } = debug;
    const realSunAltitude = real.bodies.find((b) => b.name === "sun")?.altitude;
    const sunAltitude = useGlide(debug.sunAltitude ?? realSunAltitude) ?? NIGHT_UNTIL_KNOWN;
    const palette = skyColors(sunAltitude);

    const sensors = useDeviceOrientation(!!coords, debug.lookAt);
    const { declination } = sensors;

    // wait for the first sensor readings and the location, so sky appears already in place
    const [waitedTooLong, setWaitedTooLong] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => setWaitedTooLong(true), MAX_SKY_WAIT_MS);
        return () => clearTimeout(timer);
    }, []);
    const [skyReady, setSkyReady] = useState(false);
    if (!skyReady && (waitedTooLong || (sensors.ready && (!!coords || !!locationError)))) setSkyReady(true);

    const skyOpacity = useRef(new Animated.Value(0)).current;
    const [finding, setFinding] = useState(true);
    useEffect(() => {
        if (!skyReady) return;
        Animated.timing(skyOpacity, { toValue: 1, duration: SKY_FADE_MS, useNativeDriver: true }).start(() => setFinding(false));
    }, [skyReady, skyOpacity]);

    const partnerLocation = partnerLeft ? null : pair?.partnerLocation;
    const partnerDirection = coords && partnerLocation ? directionTo(coords, partnerLocation) : null;
    const partner = partnerDirection && partnerDirection.km >= PARTNER_NEARBY_KM ? partnerDirection : null;

    const [myLooking, setMyLooking] = useState<Looking>(null);
    const handleLookingChange = (looking: Looking) => {
        setMyLooking(looking);
        setLooking(looking);
    };

    const together = !partnerLeft && !!myLooking && !!partnerLooking;
    const timeTogether = useTimeTogether(together);

    const link = partnerLooking ? { to: myLooking ?? partnerLooking, together } : null;

    useLookUpAlerts({ enabled: notifications.lookUp, pairId, deviceId, myLooking, partnerOnline });

    const handleDisconnect = async () => {
        if (pair && deviceId) {
            try {
                await setPresence(pair.id, deviceId, false);
            } catch (err: any) {
                console.warn("Couldn't update presence on disconnect:", err.message);
            }
        }
        await cancelSkyReminders();
        await clearPair();
    };

    const [disconnectSheet, setDisconnectSheet] = useState(false);

    const status = partnerLeft
        ? { text: "Your special someone left this connection.", color: COLORS.muted }
        : partnerLooking
            ? { text: `● Your special someone is looking at the ${partnerLooking} right now`, color: COLORS.online }
            : partnerOnline
                ? { text: "● Your special someone is here now", color: COLORS.online }
                : { text: "○ Your special someone isn't in the app right now", color: COLORS.muted };

    if (!pairId) return <Redirect href="/" />;

    return (
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
                    ...debug.items,
                    ...(notifications.supported
                        ? [{ label: "Test reminder in 10s", onPress: () => sendTestReminder(active?.name ?? "sun") }]
                        : []),
                ]}
            />

            <View
                pointerEvents="box-none"
                style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + 20, paddingHorizontal: 24, alignItems: "center", zIndex: 2 }}
            >
                <View
                    style={{
                        maxWidth: MAX_TEXT_WIDTH * s, alignItems: "center", gap: 2 * s,
                        paddingVertical: 8 * s, paddingHorizontal: 16 * s,
                        borderRadius: together ? 20 * s : 999,
                        backgroundColor: palette.card,
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
                        <Pressable onPress={() => setClosedError(null)} hitSlop={8}>
                            <Body style={{ color: COLORS.link, fontSize: 12 * s, lineHeight: 17 * s }}>Location is off - tap to fix</Body>
                        </Pressable>
                    )}
                </View>
            </View>

            <SideMenu open={menuOpen} onOpenChange={setMenuOpen} background={palette.surface}>
                <View style={{ gap: 24 }}>
                    {pair && (
                        <>
                            <View style={{ gap: 12 }}>
                                <MenuHeading color={palette.menuMuted}>Your connection</MenuHeading>
                                <CodeRow code={pair.code} size={18} accent={palette.menuAccent} />
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

            <BottomSheet open={locationSheet} onClose={closeLocationSheet} background={palette.surface}>
                <Title style={{ fontSize: 32, lineHeight: 38 }}>Location needed</Title>
                <Body style={{ color: COLORS.muted }}>
                    {canAskAgain
                        ? "Stellate uses your location to find where the sun and moon are in your sky."
                        : "Location is off for Stellate. Turn it on in Settings to find the sun and moon in your sky."}
                </Body>
                <View style={{ gap: 4 }}>
                    <Button label={canAskAgain ? "Allow location" : "Open Settings"} onPress={fixLocation} />
                    <Button label="Not now" variant="ghost" onPress={closeLocationSheet} />
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
