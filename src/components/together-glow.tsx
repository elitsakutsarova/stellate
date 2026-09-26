import { useEffect, useRef } from "react";
import { Animated, StyleSheet } from "react-native";
import { useSafeAreaFrame } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

const GLOW = "#F7B7C8";
const EDGE_PX = 14;    // how far the glow reaches in from each edge
const FADE_MS = 900;   // fade in/out when the moment starts/ends
const PULSE_MS = 1600; // half a breath: bright -> dim, then dim -> bright

// A soft glow along the screen edges that gently pulses while you're both
// looking at the sky. Always rendered, just faded in/out, so it eases in
// rather than popping. Both animations run on the native side
// (useNativeDriver), so they cost no re-renders.
export function TogetherGlow({ visible }: { visible: boolean }) {
    const { width, height } = useSafeAreaFrame();
    const fade = useRef(new Animated.Value(0)).current;
    const pulse = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        Animated.timing(fade, { toValue: visible ? 1 : 0, duration: FADE_MS, useNativeDriver: true }).start();
        if (!visible) return;

        const breathing = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, { toValue: 0.35, duration: PULSE_MS, useNativeDriver: true }),
                Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
            ])
        );
        breathing.start();
        return () => breathing.stop();
    }, [visible, fade, pulse]);

    // one strip per edge; each gradient runs from that edge (glow) inwards (clear)
    const edges = [
        { id: "top", x: 0, y: 0, w: width, h: EDGE_PX, dir: { x1: 0, y1: 0, x2: 0, y2: 1 } },
        { id: "bottom", x: 0, y: height - EDGE_PX, w: width, h: EDGE_PX, dir: { x1: 0, y1: 1, x2: 0, y2: 0 } },
        { id: "left", x: 0, y: 0, w: EDGE_PX, h: height, dir: { x1: 0, y1: 0, x2: 1, y2: 0 } },
        { id: "right", x: width - EDGE_PX, y: 0, w: EDGE_PX, h: height, dir: { x1: 1, y1: 0, x2: 0, y2: 0 } },
    ];

    return (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: Animated.multiply(fade, pulse) }]}>
            <Svg style={StyleSheet.absoluteFill}>
                <Defs>
                    {edges.map(({ id, dir }) => (
                        <LinearGradient key={id} id={`glow-${id}`} {...dir}>
                            <Stop offset="0" stopColor={GLOW} stopOpacity="0.35" />
                            <Stop offset="1" stopColor={GLOW} stopOpacity="0" />
                        </LinearGradient>
                    ))}
                </Defs>
                {edges.map(({ id, x, y, w, h }) => (
                    <Rect key={id} x={x} y={y} width={w} height={h} fill={`url(#glow-${id})`} />
                ))}
            </Svg>
        </Animated.View>
    );
}
