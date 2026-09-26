import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaFrame } from "react-native-safe-area-context";
import Svg, { Circle, Defs, Line, LinearGradient, Polygon, Polyline, RadialGradient, Rect, Stop, Text } from "react-native-svg";
import { groundPolygon, projectToScreen, type SkyBody } from "@/hooks/use-sky-bodies";
import { lerpVec, normalize, type Vec3 } from "@/hooks/use-device-orientation";

type Props = {
    bodies: SkyBody[];
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

// Stylised night palette — placeholder until there's a real design.
const COLORS = {
    skyTop: "#0A0F2C",
    skyMid: "#1B1F4B",
    skyBottom: "#3A2E5C",
    groundNear: "#1C1A3F", // at the horizon: clearly not sky…
    groundFar: "#05060F",  // …getting darker further down
    horizon: "#A9B4FF",
    label: "#C8CEF5",
    north: "#F7B7C8",
    grid: "#A9B4FF",
    star: "#FFFFFF",
};

// The main colour of each body's glow — also used by the "found it" flash,
// so the flash always matches what you're looking at.
export const BODY_COLORS = { sun: "#FFD27A", moon: "#DDE3FF" } as const;

const GRID_OPACITY = 0.08;

// Grid lines as lists of (bearing, altitude) points, built once:
// - a line from the horizon up to straight overhead every 30° of bearing
// - circles around the sky at 30° and 60° altitude
// Every point goes through the same projection as everything else, so the
// grid moves with the sky.
const range = (from: number, to: number, step: number) =>
    Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
const GRID_LINES = [
    ...range(0, 330, 30).map((bearing) => range(0, 90, 5).map((altitude) => ({ bearing, altitude }))),
    ...[30, 60].map((altitude) => range(0, 360, 5).map((bearing) => ({ bearing, altitude }))),
];

// Decorative stars: random, but from a fixed seed, so it's the same sky every
// night. Placed in the sky sphere (bearing/altitude), not on the screen, so
// they move correctly as you turn.
function seededRandom(seed: number) {
    // mulberry32 — a tiny, well-known pseudo-random generator
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const random = seededRandom(42);
const STARS = Array.from({ length: 150 }, () => ({
    bearing: random() * 360,
    // asin spreads them evenly over the dome, instead of bunching up overhead
    altitude: (Math.asin(random()) * 180) / Math.PI,
    radius: 0.6 + random() * 1.0,
    opacity: 0.3 + random() * 0.6,
}));
// stars are fully out once the sun is this far below the horizon (nautical
// twilight); they fade in from sunset until then
const FULL_NIGHT_SUN_ALTITUDE = -12;

// Per animation frame, move this fraction of the way towards the latest
// sensor reading — the same smoothing the sun/moon icon used to have, now for
// the whole sky at once so the body and horizon can never drift apart.
const SMOOTHING = 0.1;

const distance = (a: Vec3, b: Vec3) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);

// Sensors only update ~10 times a second; drawing straight from them looks
// jumpy. This follows the latest E/N/U every frame (~60/s), easing towards it.
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
            // already there (e.g. phone lying still) — skip the re-render
            const moved = distance(next.E, current.E) + distance(next.N, current.N) + distance(next.U, current.U);
            current = next;
            if (moved > 1e-5) setSmooth(next);
        }
        loop();
        return () => cancelAnimationFrame(frame);
    }, []);

    return smooth;
}

// how far below the horizon (in px) the ground takes to go fully dark
const GROUND_FADE_PX = 320;

// points further than this from where the phone points are behind you —
// projecting them would flip them onto the screen upside down
const IN_FRONT_DEG = 80;

// The drawn sky behind everything on the sky screen: background, stars, grid,
// ground, horizon, compass letters and the sun/moon — all positioned from the same
// E/N/U, so they move together as one space as you turn the phone.
export function SkyScene({ bodies, declination, ...raw }: Props) {
    const { width, height } = useSafeAreaFrame();
    const { E, N, U } = useSmoothedBasis(raw.E, raw.N, raw.U);
    const { ground, horizon, groundDir } = groundPolygon(U, width, height);
    // the ground gradient runs from the horizon line straight "down" into the ground
    const fadeFrom = horizon.length === 2
        ? { x: (horizon[0][0] + horizon[1][0]) / 2, y: (horizon[0][1] + horizon[1][1]) / 2 }
        : { x: width / 2, y: height / 2 };
    const fadeTo = { x: fadeFrom.x + groundDir.x * GROUND_FADE_PX, y: fadeFrom.y + groundDir.y * GROUND_FADE_PX };
    const at = (bearing: number, altitude: number) =>
        projectToScreen(E, N, U, declination, bearing, altitude, width, height);

    // Splits a line into the parts in front of you, as SVG point strings —
    // points behind you would flip across the screen.
    const visibleSegments = (points: { bearing: number; altitude: number }[]) => {
        const segments: string[][] = [[]];
        for (const { bearing, altitude } of points) {
            const p = at(bearing, altitude);
            if (p.angleFromCenter < IN_FRONT_DEG) segments[segments.length - 1].push(`${p.x},${p.y}`);
            else if (segments[segments.length - 1].length > 0) segments.push([]);
        }
        return segments.filter((seg) => seg.length > 1).map((seg) => seg.join(" "));
    };

    // 0 while the sun is up, 1 at full night
    const sunAltitude = bodies.find((b) => b.name === "sun")?.altitude ?? 0;
    const night = Math.min(1, Math.max(0, sunAltitude / FULL_NIGHT_SUN_ALTITUDE));

    // where each body lands on screen right now (skipping ones behind you)
    const placed = bodies
        .map((body) => ({ body, p: at(body.bearing, body.altitude) }))
        .filter(({ p }) => p.angleFromCenter < IN_FRONT_DEG);

    return (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
                <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={COLORS.skyTop} />
                    <Stop offset="0.6" stopColor={COLORS.skyMid} />
                    <Stop offset="1" stopColor={COLORS.skyBottom} />
                </LinearGradient>
                <LinearGradient
                    id="ground" gradientUnits="userSpaceOnUse"
                    x1={fadeFrom.x} y1={fadeFrom.y} x2={fadeTo.x} y2={fadeTo.y}
                >
                    <Stop offset="0" stopColor={COLORS.groundNear} />
                    <Stop offset="1" stopColor={COLORS.groundFar} />
                </LinearGradient>
                <RadialGradient id="sun">
                    <Stop offset="0" stopColor="#FFF4D6" />
                    <Stop offset="0.3" stopColor={BODY_COLORS.sun} stopOpacity="0.9" />
                    <Stop offset="1" stopColor="#FFB347" stopOpacity="0" />
                </RadialGradient>
                <RadialGradient id="moon">
                    <Stop offset="0" stopColor="#F5F3EE" />
                    <Stop offset="0.3" stopColor={BODY_COLORS.moon} stopOpacity="0.7" />
                    <Stop offset="1" stopColor="#C9D3FF" stopOpacity="0" />
                </RadialGradient>
            </Defs>

            <Rect x="0" y="0" width={width} height={height} fill="url(#sky)" />

            {night > 0 && STARS.map((star, i) => {
                const p = at(star.bearing, star.altitude);
                if (!p.visible) return null;
                return <Circle key={i} cx={p.x} cy={p.y} r={star.radius} fill={COLORS.star} fillOpacity={star.opacity * night} />;
            })}

            {GRID_LINES.flatMap((line, i) => visibleSegments(line).map((points, j) => (
                <Polyline
                    key={`${i}-${j}`}
                    points={points}
                    fill="none" stroke={COLORS.grid} strokeOpacity={GRID_OPACITY} strokeWidth={1}
                />
            )))}

            {/* drawn before the ground, so a setting sun/moon sinks behind it */}
            {placed.map(({ body, p }) => (
                <Circle
                    key={body.name}
                    cx={p.x} cy={p.y}
                    r={body.name === "sun" ? 56 : 48}
                    fill={`url(#${body.name})`}
                />
            ))}

            {ground.length > 2 && (
                <Polygon points={ground.map((p) => p.join(",")).join(" ")} fill="url(#ground)" />
            )}
            {horizon.length === 2 && (
                <Line
                    x1={horizon[0][0]} y1={horizon[0][1]}
                    x2={horizon[1][0]} y2={horizon[1][1]}
                    stroke={COLORS.horizon} strokeOpacity={0.25} strokeWidth={1}
                />
            )}

            {/* below the horizon: a faint outline through the ground shows where it is */}
            {placed.filter(({ body }) => body.altitude < 0).map(({ body, p }) => (
                <Circle
                    key={`${body.name}-ring`}
                    cx={p.x} cy={p.y} r={14}
                    fill="none" stroke={COLORS.label} strokeOpacity={0.35} strokeDasharray="3 4"
                />
            ))}

            {CARDINALS.map(({ label, bearing }) => {
                const p = at(bearing, 0);
                if (p.angleFromCenter > IN_FRONT_DEG) return null;
                return (
                    <Text
                        key={label}
                        x={p.x} y={p.y - 10}
                        fill={label === "N" ? COLORS.north : COLORS.label}
                        fillOpacity={0.5}
                        fontSize={16} fontWeight="600" textAnchor="middle"
                    >
                        {label}
                    </Text>
                );
            })}

        </Svg>
    );
}
