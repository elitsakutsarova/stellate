import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { useSafeAreaFrame } from "react-native-safe-area-context";
import { create } from "zustand";
import { Logo } from "@/components/art";
import { NightBackground } from "@/components/ui";
import { ARRANGEMENTS, SunMoon } from "@/components/sun-moon";
import { COLORS, fitScale } from "@/lib/theme";

// Whether the launch screen has finished and faded away - screens that play
// an entrance animation (welcome) wait for this, so it isn't wasted hidden
// underneath.
export const useLaunch = create<{ done: boolean; finish: () => void }>((set) => ({
    done: false,
    finish: () => set({ done: true }),
}));

const APPEAR_MS = 400; // sun and moon fading in around the logo
const MOVE_MS = 700;   // their quick swing to the diagonals
const FADE_MS = 450;   // the whole screen fading into the app

// The animated splash / loading screen. The phone's own splash can only be a
// still image (just the logo), so this one takes over the moment the app's
// code runs and hides the native one - same logo, same place, so you don't
// see the switch. Then the sun and moon fade in and swing round the logo.
// It's also the loading screen: no second one after it.
// It stays until the app is `ready` (fonts + saved data loaded) AND the
// animation has played, then fades away and marks the launch as done.
export function LaunchScreen({ ready }: { ready: boolean }) {
    const onDone = useLaunch((state) => state.finish);
    const { width, height } = useSafeAreaFrame();
    const k = fitScale(width, height);
    const move = useRef(new Animated.Value(0)).current;
    const appear = useRef(new Animated.Value(0)).current;
    const fade = useRef(new Animated.Value(1)).current;
    const [played, setPlayed] = useState(false);

    useEffect(() => {
        Animated.sequence([
            Animated.timing(appear, { toValue: 1, duration: APPEAR_MS, useNativeDriver: true }),
            Animated.timing(move, { toValue: 1, duration: MOVE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]).start(() => setPlayed(true));
    }, [move, appear]);

    useEffect(() => {
        if (!ready || !played) return;
        Animated.timing(fade, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => onDone());
    }, [ready, played, fade, onDone]);

    return (
        <Animated.View
            style={[StyleSheet.absoluteFill, { zIndex: 100, opacity: fade }]}
            // our screen is drawn - now the native splash can go without a flash
            onLayout={() => SplashScreen.hideAsync()}
        >
            <NightBackground glowY={0.5} />
            <View style={StyleSheet.absoluteFill}>
                <SunMoon
                    steps={[ARRANGEMENTS.loadingStart, ARRANGEMENTS.loadingEnd]}
                    progress={move} opacity={appear} color={COLORS.text} scale={k}
                />
            </View>
            <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
                <Logo width={245 * k} color={COLORS.text} />
            </View>
        </Animated.View>
    );
}
