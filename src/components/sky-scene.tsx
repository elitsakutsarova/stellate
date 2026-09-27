import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaFrame } from "react-native-safe-area-context";
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop, Text } from "react-native-svg";
import { groundPolygon, projectToScreen, towardsSun, type MoonPhase, type SkyBody } from "@/hooks/use-sky-bodies";
import { lerpVec, normalize, type Vec3 } from "@/hooks/use-device-orientation";
import { skyColors } from "@/lib/sky-colors";
import { FRAME } from "@/lib/theme";
import { Clouds, IN_FRONT_DEG, ShootingStars, Stars } from "@/components/sky-decor";

type Props = {
    bodies: SkyBody[];
    sunAltitude: number; // sets the sky's colours and the stars (can be a debug value)
    E: Vec3;
    N: Vec3;
    U: Vec3;
    declination: number;
};

const CARDINALS = [
    { label: "N", bearing: 0 },
    { label: "E", bearing: 90 },
    { label: "S", bearing: 180 },
    { label: "W", bearing: 270 },
];

const COLORS = {
    groundFar: "#05060F", // deep below the horizon (just below it follows the time of day)
    horizon: "#A9B4FF",
    label: "#C8CEF5",
    north: "#F7B7C8",
    grid: "#A9B4FF",
    moonLit: "#F5F3EE",
    moonDark: "#0A0F2C", // the unlit part: a faint disc against the sky
};

// also used by the "found it" flash
export const BODY_COLORS = { sun: "#FFD27A", moon: "#DDE3FF" } as const;

const GRID_OPACITY = 0.08;

// Grid: a line every 30 degrees of bearing, plus circles at 30 and 60 degrees altitude.
const range = (from: number, to: number, step: number) =>
    Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
const GRID_LINES = [
    ...range(0, 330, 30).map((bearing) => range(0, 90, 5).map((altitude) => ({ bearing, altitude }))),
    ...[30, 60].map((altitude) => range(0, 360, 5).map((bearing) => ({ bearing, altitude }))),
];

// stars are fully out at nautical twilight (sun 12 degrees below the horizon)
const FULL_NIGHT_SUN_ALTITUDE = -12;

const SMOOTHING = 0.1;

const distance = (a: Vec3, b: Vec3) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);

// Sensors update ~30 times a second; this eases towards them every frame, so the
// whole sky moves smoothly and together.
function useSmoothedBasis(E: Vec3, N: Vec3, U: Vec3) {
    const target = useRef({ E, N, U });
    target.current = { E, N, U };
    const [smooth, setSmooth] = useState({ E, N, U });

    useEffect(() => {
        let current = target.current;
        let frame: number;
        function loop() {
            frame = requestAnimationFrame(loop);
            const t = target.current;
            const next = {
                E: normalize(lerpVec(current.E, t.E, SMOOTHING)),
                N: normalize(lerpVec(current.N, t.N, SMOOTHING)),
                U: normalize(lerpVec(current.U, t.U, SMOOTHING)),
            };
            const moved = distance(next.E, current.E) + distance(next.N, current.N) + distance(next.U, current.U);
            current = next;
            if (moved > 1e-5) setSmooth(next);
        }
        loop();
        return () => cancelAnimationFrame(frame);
    }, []);

    return smooth;
}

const GROUND_FADE_PX = 320;
const MOON_RADIUS = 13; // the disc, inside its glow

// The moon as it really looks tonight: the lit part is half the disc plus or minus half
// an ellipse (the terminator), turned so the lit side faces the sun.
function Moon({ x, y, scale, phase, angle }: { x: number; y: number; scale: number; phase: MoonPhase; angle: number }) {
    const r = MOON_RADIUS * scale;
    const terminator = r * Math.abs(1 - 2 * phase.fraction); // 0 at half moon
    const bulge = phase.fraction < 0.5 ? 0 : 1; // crescent: towards the lit side; gibbous: away
    // drawn with the lit side to the right, then turned
    const lit = `M0,${-r}A${r},${r} 0 0,1 0,${r}A${terminator},${r} 0 0,${bulge} 0,${-r}Z`;
    return (
        <G transform={`translate(${x} ${y}) rotate(${angle})`}>
            {/* dimmer glow when less of it is lit */}
            <Circle r={48 * scale} fill="url(#moon)" opacity={0.3 + 0.7 * phase.fraction} />
            <Circle r={r} fill={COLORS.moonDark} fillOpacity={0.35} />
            <Path d={lit} fill={COLORS.moonLit} />
        </G>
    );
}
// shooting stars once the stars are mostly out
const SHOOTING_STARS_FROM = 0.5;

export function SkyScene({ bodies, sunAltitude, declination, ...raw }: Props) {
    const palette = skyColors(sunAltitude);
    const { width, height } = useSafeAreaFrame();
    // The sky always shows the same degrees top to bottom, so on a taller screen (tablet)
    // it's bigger; fixed-size things (stars, glows, letters) grow with it.
    const k = Math.max(1, height / FRAME.height);
    const { E, N, U } = useSmoothedBasis(raw.E, raw.N, raw.U);
    const { ground, horizon, groundDir, horizonPoint, skyHigh } = groundPolygon(U, width, height);
    const fadeFrom = horizon.length === 2
        ? { x: (horizon[0][0] + horizon[1][0]) / 2, y: (horizon[0][1] + horizon[1][1]) / 2 }
        : { x: width / 2, y: height / 2 };
    const fadeTo = { x: fadeFrom.x + groundDir.x * GROUND_FADE_PX, y: fadeFrom.y + groundDir.y * GROUND_FADE_PX };
    const at = (bearing: number, altitude: number) =>
        projectToScreen(E, N, U, declination, bearing, altitude, width, height);

    // points behind you would flip across the screen, so lines are split there
    const visibleSegments = (points: { bearing: number; altitude: number }[]) => {
        const segments: string[][] = [[]];
        for (const { bearing, altitude } of points) {
            const p = at(bearing, altitude);
            if (p.angleFromCenter < IN_FRONT_DEG) segments[segments.length - 1].push(`${p.x},${p.y}`);
            else if (segments[segments.length - 1].length > 0) segments.push([]);
        }
        return segments.filter((seg) => seg.length > 1).map((seg) => `M${seg.join("L")}`);
    };
    // the whole grid as one path
    const grid = GRID_LINES.flatMap(visibleSegments).join("");

    const night = Math.min(1, Math.max(0, sunAltitude / FULL_NIGHT_SUN_ALTITUDE));

    const placed = bodies
        .map((body) => ({ body, p: at(body.bearing, body.altitude) }))
        .filter(({ p }) => p.angleFromCenter < IN_FRONT_DEG);

    return (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
                {/* anchored to the real horizon, not the screen */}
                <LinearGradient
                    id="sky" gradientUnits="userSpaceOnUse"
                    x1={horizonPoint.x} y1={horizonPoint.y} x2={skyHigh.x} y2={skyHigh.y}
                >
                    {palette.stops.map(({ offset, color }) => <Stop key={offset} offset={offset} stopColor={color} />)}
                </LinearGradient>
                <LinearGradient
                    id="ground" gradientUnits="userSpaceOnUse"
                    x1={fadeFrom.x} y1={fadeFrom.y} x2={fadeTo.x} y2={fadeTo.y}
                >
                    <Stop offset="0" stopColor={palette.ground} />
                    <Stop offset="1" stopColor={COLORS.groundFar} />
                </LinearGradient>
                <RadialGradient id="sun">
                    <Stop offset="0" stopColor="#FFF4D6" />
                    <Stop offset="0.3" stopColor={BODY_COLORS.sun} stopOpacity="0.9" />
                    <Stop offset="1" stopColor="#FFB347" stopOpacity="0" />
                </RadialGradient>
                {/* only a glow - the disc itself is drawn by <Moon> */}
                <RadialGradient id="moon">
                    <Stop offset="0.2" stopColor={BODY_COLORS.moon} stopOpacity="0.6" />
                    <Stop offset="0.45" stopColor={BODY_COLORS.moon} stopOpacity="0.25" />
                    <Stop offset="1" stopColor="#C9D3FF" stopOpacity="0" />
                </RadialGradient>
            </Defs>

            <Rect x="0" y="0" width={width} height={height} fill="url(#sky)" />

            <Stars at={at} night={night} scale={k} />
            <ShootingStars at={at} active={night >= SHOOTING_STARS_FROM} scale={k} />

            {grid !== "" && <Path d={grid} fill="none" stroke={COLORS.grid} strokeOpacity={GRID_OPACITY} strokeWidth={1} />}

            {/* in front of the grid, behind the sun/moon glows */}
            <Clouds at={at} color={palette.cloud} opacity={palette.cloudOpacity} bodies={bodies} />

            {/* drawn before the ground, so a setting sun/moon sinks behind it */}
            {placed.map(({ body, p }) => body.phase ? (
                <Moon
                    key={body.name} x={p.x} y={p.y} scale={k} phase={body.phase}
                    // lit side to the right when waxing, left when waning (as seen from the north)
                    angle={(body.phase.sun && towardsSun(body, body.phase.sun, at)) ?? (body.phase.waxing ? 0 : 180)}
                />
            ) : (
                <Circle key={body.name} cx={p.x} cy={p.y} r={56 * k} fill="url(#sun)" />
            ))}

            {ground.length > 2 && (
                <Polygon points={ground.map((p) => p.join(",")).join(" ")} fill="url(#ground)" />
            )}
            {horizon.length === 2 && (
                <Line
                    x1={horizon[0][0]} y1={horizon[0][1]}
                    x2={horizon[1][0]} y2={horizon[1][1]}
                    stroke={palette.labels} strokeOpacity={0.35} strokeWidth={1}
                />
            )}

            {/* below the horizon: a faint outline through the ground shows where it is */}
            {placed.filter(({ body }) => body.altitude < 0).map(({ body, p }) => (
                <Circle
                    key={`${body.name}-ring`}
                    cx={p.x} cy={p.y} r={14 * k}
                    fill="none" stroke={COLORS.label} strokeOpacity={0.35} strokeDasharray="3 4"
                />
            ))}

            {CARDINALS.map(({ label, bearing }) => {
                const p = at(bearing, 0);
                if (p.angleFromCenter > IN_FRONT_DEG) return null;
                return (
                    <Text
                        key={label}
                        x={p.x} y={p.y - 10 * k}
                        fill={label === "N" ? palette.north : palette.labels}
                        fillOpacity={0.5}
                        fontSize={16 * k} fontWeight="600" textAnchor="middle"
                    >
                        {label}
                    </Text>
                );
            })}

        </Svg>
    );
}
