import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaFrame } from "react-native-safe-area-context";
import Svg, { Circle, Defs, Line, LinearGradient, Polygon, RadialGradient, Rect, Stop, Text } from "react-native-svg";
import { groundPolygon, projectToScreen } from "@/hooks/use-sky-bodies";
import { lerpVec, normalize, type Vec3 } from "@/hooks/use-device-orientation";

type ActiveBody = { name: "sun" | "moon"; altitude: number; bearing: number };

type Props = {
    active: ActiveBody | null;
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
};

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

// The drawn sky behind everything on the sky screen: background, ground,
// horizon, compass letters and the sun/moon — all positioned from the same
// E/N/U, so they move together as one space as you turn the phone.
export function SkyScene({ active, declination, ...raw }: Props) {
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

    const body = active ? at(active.bearing, active.altitude) : null;
    const isSun = active?.name === "sun";

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
                    <Stop offset="0.3" stopColor="#FFD27A" stopOpacity="0.9" />
                    <Stop offset="1" stopColor="#FFB347" stopOpacity="0" />
                </RadialGradient>
                <RadialGradient id="moon">
                    <Stop offset="0" stopColor="#F5F3EE" />
                    <Stop offset="0.3" stopColor="#DDE3FF" stopOpacity="0.7" />
                    <Stop offset="1" stopColor="#C9D3FF" stopOpacity="0" />
                </RadialGradient>
            </Defs>

            <Rect x="0" y="0" width={width} height={height} fill="url(#sky)" />

            {/* drawn before the ground, so a setting sun/moon sinks behind it */}
            {body && body.angleFromCenter < IN_FRONT_DEG && (
                <Circle cx={body.x} cy={body.y} r={isSun ? 56 : 48} fill={isSun ? "url(#sun)" : "url(#moon)"} />
            )}

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
            {active && active.altitude < 0 && body && body.angleFromCenter < IN_FRONT_DEG && (
                <Circle cx={body.x} cy={body.y} r={14} fill="none" stroke={COLORS.label} strokeOpacity={0.35} strokeDasharray="3 4" />
            )}

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
