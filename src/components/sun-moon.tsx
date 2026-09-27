import { Animated } from "react-native";
import { Moon, MOON_SIZE, Sun, SUN_SIZE } from "@/components/art";

// offset from the anchor (design points), rotation, and size vs the original SVG
type Pose = { x: number; y: number; rotate: number; scale: number };
export type Arrangement = { moon: Pose; sun: Pose };

export const ARRANGEMENTS = {
    loadingStart: {
        moon: { x: 0, y: -145, rotate: 90, scale: 1.53 },
        sun: { x: 0, y: 172, rotate: 90, scale: 1.54 },
    },
    loadingEnd: {
        moon: { x: -117, y: -110, rotate: 45, scale: 1.53 },
        sun: { x: 141, y: 201, rotate: 45, scale: 1.54 },
    },
    welcomeStart: {
        moon: { x: -68, y: 0, rotate: 0, scale: 1 },
        sun: { x: 75, y: 0, rotate: 0, scale: 0.9 },
    },
    welcomeEnd: {
        moon: { x: -50, y: -12, rotate: -30, scale: 1 },
        sun: { x: 59, y: 12, rotate: -30, scale: 0.9 },
    },
} satisfies Record<string, Arrangement>;


export function SunMoon({ steps, progress, color, scale: k, opacity }: {
    steps: Arrangement[];
    progress: Animated.Value;
    color: string;
    scale: number;            // design points -> screen points (see fitScale)
    opacity?: Animated.Value; // e.g. to fade them in
}) {
    const inputRange = steps.map((_, i) => i);
    const DRAW_SCALE = Math.max(...steps.flatMap((a) => [a.moon.scale, a.sun.scale])) * k;

    const animatedPose = (poses: Pose[]) => {
        const along = (values: number[]) => progress.interpolate({ inputRange, outputRange: values, extrapolate: "clamp" });
        return [
            { translateX: along(poses.map((p) => p.x * k)) },
            { translateY: along(poses.map((p) => p.y * k)) },
            { rotate: progress.interpolate({ inputRange, outputRange: poses.map((p) => `${p.rotate}deg`), extrapolate: "clamp" }) },
            { scale: along(poses.map((p) => (p.scale * k) / DRAW_SCALE)) },
        ];
    };

    const place = (w: number, h: number) =>
        ({ position: "absolute", left: -w / 2, top: -h / 2, width: w, height: h }) as const;
    const moonW = MOON_SIZE.width * DRAW_SCALE, moonH = MOON_SIZE.height * DRAW_SCALE;
    const sunW = SUN_SIZE.width * DRAW_SCALE, sunH = SUN_SIZE.height * DRAW_SCALE;

    return (
        <Animated.View
            pointerEvents="none"
            style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0, opacity: opacity ?? 1 }}
        >
            <Animated.View style={[place(moonW, moonH), { transform: animatedPose(steps.map((a) => a.moon)) }]}>
                <Moon width={moonW} color={color} />
            </Animated.View>
            <Animated.View style={[place(sunW, sunH), { transform: animatedPose(steps.map((a) => a.sun)) }]}>
                <Sun width={sunW} color={color} />
            </Animated.View>
        </Animated.View>
    );
}
