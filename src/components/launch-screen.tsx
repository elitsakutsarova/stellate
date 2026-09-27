import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { create } from "zustand";
import { Logo } from "@/components/art";
import { NightBackground } from "@/components/ui";
import { ARRANGEMENTS, SunMoon } from "@/components/sun-moon";
import { COLORS } from "@/lib/theme";

// Screens with an entrance animation wait for this, so it isn't played hidden.
export const useLaunch = create<{ done: boolean; finish: () => void }>((set) => ({
    done: false,
    finish: () => set({ done: true }),
}));

// Must match app.json's splash imageWidth, so the hand-over can't be seen. 180 keeps
// the wide logo inside the circle Android 12+ fits splash images into.
const SPLASH_LOGO_WIDTH = 180;
const DESIGN_LOGO_WIDTH = 245; // the logo's width in the design frames

const APPEAR_MS = 400; // sun and moon fading in around the logo
const MOVE_MS = 700;   // their quick swing to the diagonals
const FADE_MS = 450;   // the whole screen fading into the app

// Takes over from the native splash (same logo, same place), plays the sun/moon
// animation, and fades out once the app is ready.
export function LaunchScreen({ ready }: { ready: boolean }) {
    const onDone = useLaunch((state) => state.finish);
    const k = SPLASH_LOGO_WIDTH / DESIGN_LOGO_WIDTH;
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
            // our screen is drawn - the native splash can go
            onLayout={() => SplashScreen.hideAsync()}
        >
            {/* plain navy like the native splash; the gradient fades in */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.night }]} />
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: appear }]}>
                <NightBackground glowY={0.5} />
            </Animated.View>
            <View style={StyleSheet.absoluteFill}>
                <SunMoon
                    steps={[ARRANGEMENTS.loadingStart, ARRANGEMENTS.loadingEnd]}
                    progress={move} opacity={appear} color={COLORS.text} scale={k}
                />
            </View>
            <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
                <Logo width={SPLASH_LOGO_WIDTH} color={COLORS.text} />
            </View>
        </Animated.View>
    );
}
