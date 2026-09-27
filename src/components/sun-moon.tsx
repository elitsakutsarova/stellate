import { Animated } from "react-native";
import { Moon, MOON_SIZE, Sun, SUN_SIZE } from "@/components/art";

// Where a drawing sits: its centre's offset from the art's anchor point (in
// the Figma frames' points), how far it's turned, and how big it is
// compared to the original SVG.
type Pose = { x: number; y: number; rotate: number; scale: number };
export type Arrangement = { moon: Pose; sun: Pose };

// Measured from the designs (393 pt wide frames).
export const ARRANGEMENTS = {
    // loading: moon above the logo, sun below...
    loadingStart: {
        moon: { x: 0, y: -145, rotate: 90, scale: 1.53 },
        sun: { x: 0, y: 172, rotate: 90, scale: 1.54 },
    },
    // ...then both swing round to the diagonals - both turning the same way
    // (anticlockwise), like they're orbiting the logo together
    loadingEnd: {
        moon: { x: -117, y: -110, rotate: 45, scale: 1.53 },
        sun: { x: 141, y: 201, rotate: 45, scale: 1.54 },
    },
    // welcome, arriving: moon and half-sun together, like one round body...
    welcomeStart: {
        moon: { x: -68, y: 0, rotate: 0, scale: 1 },
        sun: { x: 75, y: 0, rotate: 0, scale: 0.9 },
    },
    // ...then they drift apart, both tilted
    welcomeEnd: {
        moon: { x: -50, y: -12, rotate: -30, scale: 1 },
        sun: { x: 59, y: 12, rotate: -30, scale: 0.9 },
    },
} satisfies Record<string, Arrangement>;

// The design frames' size. fitScale: how much bigger this screen is than
// a frame, limited by whichever side has less room - so things grow on a
// tablet but never spill off a wide-but-short screen.
export const FRAME = { width: 393, height: 852 };
export const fitScale = (width: number, height: number) => Math.min(width / FRAME.width, height / FRAME.height);

// The line-art sun and moon, moving through a sequence of arrangements:
// progress 0 = steps[0], 1 = steps[1], 2 = steps[2]... and smoothly in
// between - like the same picture animating from slide to slide.
// Positioned around the centre of whatever view this is placed in.
export function SunMoon({ steps, progress, color, scale: k, opacity }: {
    steps: Arrangement[];
    progress: Animated.Value;
    color: string;
    scale: number;            // design points -> screen points (see fitScale)
    opacity?: Animated.Value; // e.g. to fade them in
}) {
    const inputRange = steps.map((_, i) => i);
    // Drawn at the biggest size they'll need in any step and only ever scaled
    // *down* from there, so the lines stay crisp (scaling a view up blurs it).
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
        // zero-size anchor in the middle of the parent; drawings hang off it
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
