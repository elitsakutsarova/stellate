import { useEffect, useRef } from "react";
import { Animated, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaFrame } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { BODY_COLORS } from "@/components/sky-scene";
import type { Looking } from "@/hooks/use-pair-presence";

const EDGE_PX = 14;        // how far a glow reaches in from each edge
const TOGETHER_COLOR = "#F7B7C8";
const FADE_MS = 1400;      // together glow fading in/out
const PULSE_MS = 2200;     // half a breath: bright -> dim, then dim -> bright
const FLASH_IN_MS = 300;   // "found it" flash: up…
const FLASH_OUT_MS = 900;  // …and gently back down

// Thin strips along all four screen edges, each fading from `color` at the
// edge to clear inwards. The shared look for every edge glow; the parent
// animates its opacity.
function EdgeStrips({ id, color, opacity }: { id: string; color: string; opacity: number }) {
    const { width, height } = useSafeAreaFrame();
    const edges = [
        { side: "top", x: 0, y: 0, w: width, h: EDGE_PX, dir: { x1: 0, y1: 0, x2: 0, y2: 1 } },
        { side: "bottom", x: 0, y: height - EDGE_PX, w: width, h: EDGE_PX, dir: { x1: 0, y1: 1, x2: 0, y2: 0 } },
        { side: "left", x: 0, y: 0, w: EDGE_PX, h: height, dir: { x1: 0, y1: 0, x2: 1, y2: 0 } },
        { side: "right", x: width - EDGE_PX, y: 0, w: EDGE_PX, h: height, dir: { x1: 1, y1: 0, x2: 0, y2: 0 } },
    ];
    return (
        <Svg style={StyleSheet.absoluteFill}>
            <Defs>
                {edges.map(({ side, dir }) => (
                    <LinearGradient key={side} id={`${id}-${side}`} {...dir}>
                        <Stop offset="0" stopColor={color} stopOpacity={opacity} />
                        <Stop offset="1" stopColor={color} stopOpacity="0" />
                    </LinearGradient>
                ))}
            </Defs>
            {edges.map(({ side, x, y, w, h }) => (
                <Rect key={side} x={x} y={y} width={w} height={h} fill={`url(#${id}-${side})`} />
            ))}
        </Svg>
    );
}

// While you're both looking at the sky: a soft pink edge glow that gently
// breathes, with one success buzz as it starts. Always rendered, just faded in/out, so it eases in
// rather than popping. Animations run on the native side (useNativeDriver),
// so they cost no re-renders.
export function TogetherGlow({ visible }: { visible: boolean }) {
    const fade = useRef(new Animated.Value(0)).current;
    const pulse = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        Animated.timing(fade, { toValue: visible ? 1 : 0, duration: FADE_MS, useNativeDriver: true }).start();
        if (!visible) return;

        pulse.setValue(1); // start every moment at a bright peak
        const breathing = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, { toValue: 0.35, duration: PULSE_MS, useNativeDriver: true }),
                Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
            ])
        );
        breathing.start();

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        // moment over (or screen left): stop breathing
        return () => breathing.stop();
    }, [visible, fade, pulse]);

    return (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: Animated.multiply(fade, pulse) }]}>
            <EdgeStrips id="together" color={TOGETHER_COLOR} opacity={0.35} />
        </Animated.View>
    );
}

// One short edge flash in the colour of the sun/moon, the moment it comes on
// screen — fired by the same change that triggers the viewfinder's haptic.
export function FoundFlash({ looking }: { looking: Looking }) {
    const opacity = useRef(new Animated.Value(0)).current;
    // keep the last colour, so the flash doesn't change colour while fading out
    const color = useRef<string>(BODY_COLORS.sun);
    if (looking) color.current = BODY_COLORS[looking];

    useEffect(() => {
        if (!looking) return;
        Animated.sequence([
            Animated.timing(opacity, { toValue: 1, duration: FLASH_IN_MS, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0, duration: FLASH_OUT_MS, useNativeDriver: true }),
        ]).start();
    }, [looking, opacity]);

    return (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
            <EdgeStrips id="found" color={color.current} opacity={0.5} />
        </Animated.View>
    );
}
