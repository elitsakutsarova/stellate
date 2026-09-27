import { useEffect, useRef, useState } from "react";
import {
  Alert, Animated, BackHandler, Easing, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createPair, joinPair } from "@/lib/api";
import { closeOldPairChannel, supabase } from "@/lib/supabase";
import { pairChannel, PAIR_CHANGED_EVENT } from "@/lib/constants";
import { COLORS, FONTS, FRAME, fitScale } from "@/lib/theme";
import { usePairStore } from "@/store/use-pair-store";
import { Logo } from "@/components/art";
import { CodeRow } from "@/components/code-row";
import { ARRANGEMENTS, SunMoon } from "@/components/sun-moon";
import { BottomSheet } from "@/components/bottom-sheet";
import { useLaunch } from "@/components/launch-screen";
import { Body, Button, glass, MAX_TEXT_WIDTH, NightBackground, Title, WaitingLine } from "@/components/ui";

type Step = "welcome" | "connect";
type Pair = { id: string; code: string };

const ARRIVE_DELAY_MS = 800; // on arriving: a moment to take it in, then...
const ARRIVE_MS = 700;       // ...sun + moon drift apart
const MOVE_MS = 650;         // welcome <-> connect
const TEXT_OUT_MS = 180;     // panel text fading out...
const TEXT_IN_MS = 260;      // ...and the next step's fading in

const ART_STEPS = [ARRANGEMENTS.welcomeStart, ARRANGEMENTS.welcomeEnd];
const ART_HEIGHT = 270;      // room the art needs, in design points
const LOGO_WIDTH = 96;       // in design points
const SIDE = 24;             // left/right padding of the panel content
const BOTTOM_GAP = 24;       // space under the last button

const PANEL = {
  welcome: { wave: 100, contentTop: 70 },
  connect: { wave: 40, contentTop: 60 },
};

export default function Index() {
  const insets = useSafeAreaInsets();
  const { width, height } = useSafeAreaFrame();
  const launchDone = useLaunch((state) => state.done);
  const deviceId = usePairStore((state) => state.deviceId);
  const pairId = usePairStore((state) => state.pairId);
  const isHydrated = usePairStore((state) => state.isHydrated);
  const setPair = usePairStore((state) => state.setPair);

  const [step, setStep] = useState<Step>("welcome");
  const art = useRef(new Animated.Value(0)).current;
  const wave = useRef(new Animated.Value(PANEL.welcome.wave)).current;
  const [waveDepth, setWaveDepth] = useState(PANEL.welcome.wave);
  const textOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const id = wave.addListener(({ value }) => setWaveDepth(value));
    return () => wave.removeListener(id);
  }, [wave]);

  const keyboardLift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const slide = (to: number, duration = 220) =>
      Animated.timing(keyboardLift, { toValue: to, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) => {
      const covered = e.endCoordinates.height - insets.bottom - BOTTOM_GAP + 12;
      slide(-Math.max(0, covered), ios ? e.duration : undefined);
    });
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", (e) =>
      slide(0, ios ? e.duration : undefined)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [keyboardLift, insets.bottom]);

  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [pendingPair, setPendingPair] = useState<Pair | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const waitChannel = useRef<RealtimeChannel | null>(null);

  const [contentHeight, setContentHeight] = useState<Record<Step, number>>({ welcome: 0, connect: 0 });
  const measured = contentHeight.welcome > 0 && contentHeight.connect > 0;
  const columnWidth = Math.min(width - SIDE * 2, MAX_TEXT_WIDTH);

  const k = fitScale(width, height);
  const logoWidth = LOGO_WIDTH * k;
  const logoTop = insets.top + 12;
  const logoBottom = logoTop + (logoWidth * 221) / 733;
  const panelTop = (s: Step) => height - insets.bottom - BOTTOM_GAP - contentHeight[s] - PANEL[s].contentTop;
  const panelBase = Math.min(panelTop("welcome"), panelTop("connect"));
  const panelShift = (s: Step) => panelTop(s) - panelBase;
  const space = (s: Step) => panelTop(s) - logoBottom; 
  const artScale = Math.min(width / FRAME.width, space("welcome") / ART_HEIGHT);
  const artY = (s: Step) => (logoBottom + panelTop(s)) / 2;

  // this waits for the launch screen to go, so this isn't played hidden
  useEffect(() => {
    if (!launchDone || !isHydrated || pairId) return;
    Animated.sequence([
      Animated.delay(ARRIVE_DELAY_MS),
      Animated.timing(art, { toValue: 1, duration: ARRIVE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [launchDone, isHydrated, pairId, art]);

  const goTo = (next: Step) => {
    const easing = Easing.inOut(Easing.cubic);
    Animated.timing(art, { toValue: next === "connect" ? 2 : 1, duration: MOVE_MS, easing, useNativeDriver: true }).start();
    Animated.timing(wave, { toValue: PANEL[next].wave, duration: MOVE_MS, easing, useNativeDriver: false }).start();
    Animated.timing(textOpacity, { toValue: 0, duration: TEXT_OUT_MS, useNativeDriver: true }).start(() => {
      setStep(next);
      Animated.timing(textOpacity, { toValue: 1, duration: TEXT_IN_MS, useNativeDriver: true }).start();
    });
  };

  useEffect(() => {
    if (step !== "connect" || sheetOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      goTo("welcome");
      return true;
    });
    return () => sub.remove();
  }, [step, sheetOpen]);

  const enterSky = async (pair: Pair) => {
    if (waitChannel.current) await supabase.removeChannel(waitChannel.current);
    waitChannel.current = null;
    await setPair(pair.id, pair.code); // with a pair - redirect to the sky
  };

  // go to the sky as soon as special someone joins
  useEffect(() => {
    if (!pendingPair) return;
    let cancelled = false;
    let channel: RealtimeChannel | undefined;
    closeOldPairChannel(pendingPair.id).then(() => {
      if (cancelled) return;
      channel = supabase
        .channel(pairChannel(pendingPair.id))
        .on("broadcast", { event: PAIR_CHANGED_EVENT }, () => enterSky(pendingPair))
        .subscribe();
      waitChannel.current = channel;
    });
    return () => {
      cancelled = true;
      if (!channel) return;
      if (waitChannel.current === channel) waitChannel.current = null;
      supabase.removeChannel(channel);
    };
  }, [pendingPair]);

  const handleCreate = async () => {
    if (!deviceId) return;
    setBusy("create");
    try {
      setPendingPair(await createPair(deviceId));
      setSheetOpen(true);
    } catch (err: any) {
      Alert.alert("Something went wrong", err.message);
    }
    setBusy(null);
  };

  const handleJoin = async () => {
    if (!deviceId || joinCode.trim().length === 0) return;
    setBusy("join");
    try {
      await enterSky(await joinPair(joinCode.trim().toUpperCase(), deviceId));
    } catch (err: any) {
      Alert.alert("Couldn't connect", err.message);
    }
    setBusy(null);
  };

  if (pairId) return <Redirect href="/sky" />;
  if (!isHydrated) return <View style={{ flex: 1, backgroundColor: COLORS.night }} />;

  const connectProps = { joinCode, setJoinCode, busy, onCreate: handleCreate, onJoin: handleJoin };

  return (
    <View style={{ flex: 1 }}>
      <NightBackground glowY={0.25} />

      <View pointerEvents="none" style={{ position: "absolute", opacity: 0, left: 0, top: 0, width: columnWidth }}>
        <View onLayout={(e) => { const h = e.nativeEvent.layout.height; setContentHeight((c) => ({ ...c, welcome: h })); }}>
          <WelcomeContent onConnect={() => {}} />
        </View>
        <View onLayout={(e) => { const h = e.nativeEvent.layout.height; setContentHeight((c) => ({ ...c, connect: h })); }}>
          <ConnectContent {...connectProps} measuring />
        </View>
      </View>

      <View pointerEvents="none" style={{ position: "absolute", top: logoTop, left: 0, right: 0, alignItems: "center" }}>
        <Logo width={logoWidth} color={COLORS.text} />
      </View>

      {measured && (
        <>
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute", left: 0, right: 0, height: 0, top: artY("welcome"),
              opacity: keyboardLift.interpolate({ inputRange: [-150, 0], outputRange: [0, 1], extrapolate: "clamp" }),
              transform: [
                {
                  translateY: art.interpolate({
                    inputRange: [0, 1, 2], outputRange: [0, 0, artY("connect") - artY("welcome")], extrapolate: "clamp",
                  }),
                },
                {
                  scale: art.interpolate({
                    inputRange: [0, 1, 2], outputRange: [1, 1, Math.min(1, space("connect") / space("welcome"))], extrapolate: "clamp",
                  }),
                },
              ],
            }}
          >
            <SunMoon steps={ART_STEPS} progress={art} color={COLORS.text} scale={artScale} />
          </Animated.View>

          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <Animated.View
              style={{
                position: "absolute", left: 0, right: 0, bottom: 0, top: panelBase,
                transform: [{
                  translateY: Animated.add(
                    art.interpolate({
                      inputRange: [1, 2], outputRange: [panelShift("welcome"), panelShift("connect")], extrapolate: "clamp",
                    }),
                    keyboardLift,
                  ),
                }],
              }}
            >
              <GlassWave depth={waveDepth} />
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  paddingTop: PANEL[step].contentTop, paddingHorizontal: SIDE,
                  paddingBottom: insets.bottom + BOTTOM_GAP + panelShift(step),
                }}
              >
                <Animated.View style={{ width: "100%", maxWidth: MAX_TEXT_WIDTH, alignSelf: "center", opacity: textOpacity }}>
                  {step === "welcome"
                    ? <WelcomeContent onConnect={() => goTo("connect")} />
                    : <ConnectContent {...connectProps} />}
                </Animated.View>
              </ScrollView>
            </Animated.View>
          </View>
        </>
      )}

      {step === "connect" && (
        <Pressable
          onPress={() => goTo("welcome")}
          hitSlop={12}
          style={{ position: "absolute", top: logoTop + 4, left: 20 }}
          accessibilityLabel="Back"
        >
          <Text style={{ fontFamily: FONTS.regular, fontSize: 15, color: COLORS.muted }}>Back</Text>
        </Pressable>
      )}

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <View style={{ gap: 4 }}>
          <Title style={{ fontSize: 32, lineHeight: 38 }}>Your code</Title>
          <Body style={{ color: COLORS.muted, fontSize: 14 }}>Invite the person you care about.</Body>
        </View>

        {pendingPair && <CodeRow code={pendingPair.code} />}

        <WaitingLine>Waiting for your special someone to join</WaitingLine>

        <Button label="Continue" onPress={() => pendingPair && enterSky(pendingPair)} />
      </BottomSheet>
    </View>
  );
}

function WelcomeContent({ onConnect }: { onConnect: () => void }) {
  return (
    <View style={{ gap: 32 }}>
      <View style={{ gap: 16 }}>
        <Title>Welcome!</Title>
        <Body>
          With <Text style={{ fontFamily: FONTS.boldItalic }}>Stellate</Text>, you can share the sky with someone
          you care about. See the same sun or moon, look up together, and{" "}
          <Text style={{ fontFamily: FONTS.medium }}>feel a little closer{" "}- wherever you{" "}are</Text>.
        </Body>
      </View>
      <Button label="Connect to special someone" onPress={onConnect} />
    </View>
  );
}

function ConnectContent({ joinCode, setJoinCode, busy, onCreate, onJoin, measuring }: {
  joinCode: string;
  setJoinCode: (code: string) => void;
  busy: "create" | "join" | null;
  onCreate: () => void;
  onJoin: () => void;
  measuring?: boolean;
}) {
  return (
    <View style={{ gap: 32 }}>
      <View style={{ gap: 16 }}>
        <Title style={{ fontSize: 34, lineHeight: 40 }}>Feel the connection thousands of miles apart</Title>
        <Body style={{ color: COLORS.muted }}>
          Generate a code and share it with someone special to connect your skies.
        </Body>
      </View>
      <View style={{ gap: 16 }}>
        <Button label="Generate code" onPress={onCreate} busy={busy === "create"} disabled={busy !== null} />
        <OrDivider />
        <View style={{ flexDirection: "row", gap: 12 }}>
          <TextInput
            editable={!measuring}
            placeholder="Enter code"
            placeholderTextColor={COLORS.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            value={joinCode}
            onChangeText={(text) => setJoinCode(text.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, ""))}
            onSubmitEditing={onJoin}
            returnKeyType="done"
            style={[glass, { flex: 1, minHeight: 54, paddingHorizontal: 16, color: COLORS.text, fontFamily: FONTS.medium, fontSize: 17, letterSpacing: 2 }]}
          />
          <Button
            label="Join" variant="glass" onPress={onJoin}
            busy={busy === "join"} disabled={busy !== null || joinCode.trim().length === 0}
          />
        </View>
      </View>
    </View>
  );
}

//for welcome screen text not to clip with bg
function GlassWave({ depth: d }: { depth: number }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { width: w, height: h } = size;
  const top =
    `M0 ${d * 0.23} ` +
    `C ${w * 0.13} ${d * 0.05}, ${w * 0.23} 0, ${w * 0.32} 0 ` +          // up into the dome
    `C ${w * 0.46} 0, ${w * 0.57} ${d * 0.19}, ${w * 0.7} ${d * 0.51} ` + // over it and down...
    `C ${w * 0.81} ${d * 0.79}, ${w * 0.89} ${d * 0.95}, ${w} ${d}`;      // ...easing into the dip

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={(e) => setSize(e.nativeEvent.layout)}>
      {w > 0 && (
        <Svg width={w} height={h}>
          <Path d={`${top} L ${w} ${h} L 0 ${h} Z`} fill={COLORS.glass} />
          <Path d={top} stroke={COLORS.glassBorder} strokeWidth={1} fill="none" />
        </Svg>
      )}
    </View>
  );
}

function OrDivider() {
  const line = { flex: 1, height: 1, backgroundColor: COLORS.glassBorder };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={line} />
      <Text style={{ fontFamily: FONTS.light, fontSize: 13, color: COLORS.muted }}>OR</Text>
      <View style={line} />
    </View>
  );
}
