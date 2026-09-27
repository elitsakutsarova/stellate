import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaFrame } from "react-native-safe-area-context";
import {
    BlurMask, Canvas, Circle, DashPathEffect, Group, LinearGradient, Path, RadialGradient, Rect, Skia, Text, useFont, vec, type SkFont,
    type SkPath,
} from "@shopify/react-native-skia";
import {
    cancelAnimation, useDerivedValue, useFrameCallback, useSharedValue, withRepeat, withSequence, withTiming, Easing,
    type SharedValue,
} from "react-native-reanimated";
import { degreesApart, focalPx, groundPolygon, pointAlong, projector, towardsSun, type MoonPhase, type SkyBody, type SkyPoint } from "@/hooks/use-sky-bodies";
import { lerpVec, normalize, type Basis, type Vec3 } from "@/hooks/use-device-orientation";
import { skyColors } from "@/lib/sky-colors";
import { COLORS as THEME, FRAME } from "@/lib/theme";
import { formatDistance } from "@/lib/geo";
import { Clouds, IN_FRONT_DEG, ShootingStars, Stars, type SkyView } from "@/components/sky-decor";

type Props = {
    bodies: SkyBody[];
    sunAltitude: number; // sets the sky's colours and the stars (can be a debug value)
    basis: SharedValue<Basis>; // where the phone points, straight from the sensors
    declination: number;
    // which way (compass bearing) your special someone is, and how far; null = unknown
    partner: { bearing: number; km: number } | null;
    // the sun/moon the line from their light goes to; together = you're both looking
    link: { to: SkyBody["name"]; together: boolean } | null;
};

const CARDINALS = [
    { label: "N", bearing: 0 },
    { label: "E", bearing: 90 },
    { label: "S", bearing: 180 },
    { label: "W", bearing: 270 },
];

const COLORS = {
    groundFar: "#05060F", // deep below the horizon (just below it follows the time of day)
    label: "#C8CEF5",
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
// shooting stars once the stars are mostly out
const SHOOTING_STARS_FROM = 0.5;

const SMOOTHING = 0.1;
const GROUND_FADE_PX = 320;
const SUN_GLOW = 56;
const MOON_GLOW = 48;
const MOON_RADIUS = 13; // the disc, inside its glow

const distance = (a: Vec3, b: Vec3) => {
    "worklet";
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
};

// Sensors update ~30 times a second; this eases towards them every frame, on the UI
// thread, so the whole sky moves smoothly and together.
function useSmoothedBasis(target: SharedValue<Basis>) {
    // read once: Reanimated warns about reading shared values while re-rendering
    const [start] = useState(() => target.value);
    const smooth = useSharedValue(start);
    useFrameCallback(() => {
        const t = target.value;
        const c = smooth.value;
        const next = {
            E: normalize(lerpVec(c.E, t.E, SMOOTHING)),
            N: normalize(lerpVec(c.N, t.N, SMOOTHING)),
            U: normalize(lerpVec(c.U, t.U, SMOOTHING)),
        };
        if (distance(next.E, c.E) + distance(next.N, c.N) + distance(next.U, c.U) > 1e-5) smooth.value = next;
    });
    return smooth;
}

// where a body is on screen, and whether it's in front of you
function useBodyPosition(sky: SkyView, body: SkyBody) {
    const { basis, declination, width, height } = sky;
    return useDerivedValue(() => {
        const p = projector(basis.value, declination, width, height)(body.bearing, body.altitude);
        return { c: vec(p.x, p.y), inFront: p.angleFromCenter < IN_FRONT_DEG };
    }, [declination, width, height, body.bearing, body.altitude]);
}

function Sun({ sky, body, scale }: { sky: SkyView; body: SkyBody; scale: number }) {
    const position = useBodyPosition(sky, body);
    const c = useDerivedValue(() => position.value.c);
    const opacity = useDerivedValue(() => (position.value.inFront ? 1 : 0));
    const r = SUN_GLOW * scale;
    return (
        <Circle c={c} r={r} opacity={opacity}>
            <RadialGradient
                c={c} r={r} positions={[0, 0.3, 1]}
                colors={["#FFF4D6", "rgba(255, 210, 122, 0.9)", "rgba(255, 179, 71, 0)"]}
            />
        </Circle>
    );
}

// The moon as it really looks tonight: the lit part is half the disc plus or minus half
// an ellipse (the terminator), turned so the lit side faces the sun.
function Moon({ sky, body, phase, scale }: { sky: SkyView; body: SkyBody; phase: MoonPhase; scale: number }) {
    const { basis, declination, width, height } = sky;
    const r = MOON_RADIUS * scale;
    const terminator = r * Math.abs(1 - 2 * phase.fraction); // 0 at half moon
    const bulge = phase.fraction < 0.5 ? 0 : 1; // crescent: towards the lit side; gibbous: away
    // drawn with the lit side to the right, then turned
    const lit = Skia.Path.MakeFromSVGString(`M0,${-r}A${r},${r} 0 0,1 0,${r}A${terminator},${r} 0 0,${bulge} 0,${-r}Z`);

    const placement = useDerivedValue(() => {
        const at = projector(basis.value, declination, width, height);
        const p = at(body.bearing, body.altitude);
        // lit side to the right when waxing, left when waning (as seen from the north)
        const angle = (phase.sun && towardsSun(body, phase.sun, at)) ?? (phase.waxing ? 0 : 180);
        return {
            transform: [{ translateX: p.x }, { translateY: p.y }, { rotate: (angle * Math.PI) / 180 }],
            opacity: p.angleFromCenter < IN_FRONT_DEG ? 1 : 0,
        };
    }, [declination, width, height, body.bearing, body.altitude, phase]);
    const transform = useDerivedValue(() => placement.value.transform);
    const opacity = useDerivedValue(() => placement.value.opacity);

    const glow = MOON_GLOW * scale;
    return (
        <Group transform={transform} opacity={opacity}>
            {/* dimmer glow when less of it is lit */}
            <Circle cx={0} cy={0} r={glow} opacity={0.3 + 0.7 * phase.fraction}>
                <RadialGradient
                    c={vec(0, 0)} r={glow} positions={[0.2, 0.45, 1]}
                    colors={["rgba(221, 227, 255, 0.6)", "rgba(221, 227, 255, 0.25)", "rgba(201, 211, 255, 0)"]}
                />
            </Circle>
            <Circle cx={0} cy={0} r={r} color={COLORS.moonDark} opacity={0.35} />
            {lit && <Path path={lit} color={COLORS.moonLit} />}
        </Group>
    );
}

// below the horizon: a faint dashed outline through the ground shows where it is
function BelowHorizonRing({ sky, body, scale }: { sky: SkyView; body: SkyBody; scale: number }) {
    const position = useBodyPosition(sky, body);
    const c = useDerivedValue(() => position.value.c);
    const opacity = useDerivedValue(() => (position.value.inFront ? 0.35 : 0));
    return (
        <Circle c={c} r={14 * scale} color={COLORS.label} opacity={opacity} style="stroke" strokeWidth={1}>
            <DashPathEffect intervals={[3, 4]} />
        </Circle>
    );
}

function Cardinal({ sky, label, bearing, font, color, scale }: {
    sky: SkyView; label: string; bearing: number; font: SkFont; color: string; scale: number;
}) {
    const { basis, declination, width, height } = sky;
    const halfWidth = font.measureText(label).width / 2;
    const place = useDerivedValue(() => {
        const p = projector(basis.value, declination, width, height)(bearing, 0);
        return { x: p.x - halfWidth, y: p.y - 10 * scale, opacity: p.angleFromCenter > IN_FRONT_DEG ? 0 : 0.5 };
    }, [declination, width, height, bearing, halfWidth, scale]);
    const x = useDerivedValue(() => place.value.x);
    const y = useDerivedValue(() => place.value.y);
    const opacity = useDerivedValue(() => place.value.opacity);
    return <Text x={x} y={y} text={label} font={font} color={color} opacity={opacity} />;
}

// A soft, breathing pink light just above your horizon, in the direction of your special
// someone - "they're over there, under the same sky" - with how far away they are.
const MARKER_ALTITUDE = 3; // degrees above the horizon
const MARKER_BREATH_MS = 1800;

function PartnerMarker({ sky, bearing, km, font, scale }: {
    sky: SkyView; bearing: number; km: number; font: SkFont | null; scale: number;
}) {
    const { basis, declination, width, height } = sky;
    const place = useDerivedValue(() => {
        const p = projector(basis.value, declination, width, height)(bearing, MARKER_ALTITUDE);
        return { x: p.x, y: p.y, inFront: p.angleFromCenter < IN_FRONT_DEG };
    }, [declination, width, height, bearing]);
    const c = useDerivedValue(() => vec(place.value.x, place.value.y));
    const opacity = useDerivedValue(() => (place.value.inFront ? 1 : 0));

    const breath = useSharedValue(0.5);
    useEffect(() => {
        const ease = { duration: MARKER_BREATH_MS, easing: Easing.inOut(Easing.sin) };
        breath.value = withRepeat(withSequence(withTiming(1, ease), withTiming(0.5, ease)), -1);
    }, [breath]);

    // two short lines above the light, centred on it
    const name = "your special someone";
    const distance = formatDistance(km);
    const nameHalf = font ? font.measureText(name).width / 2 : 0;
    const distanceHalf = font ? font.measureText(distance).width / 2 : 0;
    const nameX = useDerivedValue(() => place.value.x - nameHalf, [nameHalf]);
    const nameY = useDerivedValue(() => place.value.y - 26 * scale, [scale]);
    const distanceX = useDerivedValue(() => place.value.x - distanceHalf, [distanceHalf]);
    const distanceY = useDerivedValue(() => place.value.y - 12 * scale, [scale]);

    const glow = 18 * scale;
    return (
        <Group opacity={opacity}>
            <Circle c={c} r={glow} opacity={breath}>
                <RadialGradient c={c} r={glow} colors={["rgba(247, 183, 200, 0.85)", "rgba(247, 183, 200, 0)"]} />
            </Circle>
            <Circle c={c} r={3 * scale} color="#FFF4F7" />
            {font && (
                <>
                    <Text x={nameX} y={nameY} text={name} font={font} color={THEME.together} opacity={0.9} />
                    <Text x={distanceX} y={distanceY} text={distance} font={font} color={COLORS.label} opacity={0.7} />
                </>
            )}
        </Group>
    );
}

// Their gaze: a soft pink line from their light on your horizon, across the sky to the
// edge of the sun/moon's glow. It grows out from its middle when it appears and shrinks
// back into it when it goes. While you're both looking it brightens, and a small light travels along it.
// Drawn after the ground: the part below your horizon stays faintly visible.
const LINK_STEPS = 48;           // points along the line
const LINK_OPACITY = { alone: 0.3, together: 0.65 };
const LINK_UNDERGROUND = 0.35;   // how visible the part below the horizon is, compared to above
const LINK_FADE_MS = 800;
const LINK_GROW_MS = 1800;
const LINK_SHRINK_MS = 1100;
const LINK_STOP_SHORT = 0.6;   // ends this share of the body's glow radius away from its centre
const LINK_TRAVEL_MS = 2600;     // one trip of the travelling light

function PartnerLink({ sky, from, to, together, ground, scale }: {
    sky: SkyView;
    from: SkyPoint;
    to: (SkyPoint & { glow: number }) | null; // null = no line (shrinks away); glow = its radius, px
    together: boolean;
    ground: SharedValue<SkPath>; // the ground's outline, to tell above from below the horizon
    scale: number;
}) {
    const { basis, declination, width, height } = sky;
    // keeps the last target while shrinking away (updated during render - React's way to
    // follow a prop in state, without an effect)
    const [target, setTarget] = useState(to);
    if (to && (to.bearing !== target?.bearing || to.altitude !== target?.altitude || to.glow !== target?.glow)) setTarget(to);

    const grown = useSharedValue(0); // 0 = nothing, 1 = the whole line
    useEffect(() => {
        grown.value = withTiming(to ? 1 : 0, { duration: to ? LINK_GROW_MS : LINK_SHRINK_MS, easing: Easing.inOut(Easing.cubic) });
    }, [!!to, grown]);
    // from the middle out, both ways
    const start = useDerivedValue(() => 0.5 - grown.value / 2);
    const end = useDerivedValue(() => 0.5 + grown.value / 2);

    // where along the path to stop: at the edge of the body's glow, not its centre
    const pxPerDegree = (focalPx(height) * Math.PI) / 180;
    const stopShortDeg = target ? (target.glow * LINK_STOP_SHORT) / pxPerDegree : 0;
    const reach = (a: SkyPoint, b: SkyPoint) => {
        "worklet";
        return Math.max(0, 1 - stopShortDeg / Math.max(degreesApart(a, b), 1e-3));
    };

    const path = useDerivedValue(() => {
        const p = Skia.Path.Make();
        if (!target) return p;
        const at = projector(basis.value, declination, width, height);
        const last = reach(from, target);
        let drawing = false;
        for (let i = 0; i <= LINK_STEPS; i++) {
            const q = pointAlong(from, target, (i / LINK_STEPS) * last);
            const s = at(q.bearing, q.altitude);
            // split where it goes behind you, like the grid
            if (s.angleFromCenter >= IN_FRONT_DEG) drawing = false;
            else if (drawing) p.lineTo(s.x, s.y);
            else {
                p.moveTo(s.x, s.y);
                drawing = true;
            }
        }
        return p;
    }, [declination, width, height, from, target, stopShortDeg]);

    const opacity = useSharedValue(LINK_OPACITY.alone);
    useEffect(() => {
        opacity.value = withTiming(together ? LINK_OPACITY.together : LINK_OPACITY.alone, { duration: LINK_FADE_MS });
    }, [together, opacity]);
    const underground = useDerivedValue(() => opacity.value * LINK_UNDERGROUND);

    const travel = useSharedValue(0);
    const travelling = together && !!to;
    useEffect(() => {
        if (!travelling) {
            cancelAnimation(travel);
            travel.value = 0;
            return;
        }
        travel.value = withRepeat(withTiming(1, { duration: LINK_TRAVEL_MS, easing: Easing.inOut(Easing.quad) }), -1, false);
        return () => cancelAnimation(travel);
    }, [travelling, travel]);
    const spark = useDerivedValue(() => {
        if (!target) return { c: vec(0, 0), opacity: 0 };
        const t = travel.value;
        const q = pointAlong(from, target, t * reach(from, target));
        const s = projector(basis.value, declination, width, height)(q.bearing, q.altitude);
        // only once the line has fully grown; fades in leaving them, out arriving
        const shown = travelling && grown.value === 1 && s.angleFromCenter < IN_FRONT_DEG ? Math.sin(Math.PI * t) : 0;
        return { c: vec(s.x, s.y), opacity: shown };
    }, [declination, width, height, from, target, travelling, stopShortDeg]);
    const sparkC = useDerivedValue(() => spark.value.c);
    const sparkOpacity = useDerivedValue(() => spark.value.opacity);

    if (!target) return null;
    const line = (lineOpacity: SharedValue<number>) => (
        <Path path={path} start={start} end={end} style="stroke" strokeWidth={1.5 * scale} strokeCap="round" color={THEME.together} opacity={lineOpacity}>
            <BlurMask blur={2 * scale} style="solid" />
        </Path>
    );
    return (
        <>
            {/* above the horizon */}
            <Group clip={ground} invertClip>
                {line(opacity)}
                <Circle c={sparkC} r={3 * scale} color="#FFF4F7" opacity={sparkOpacity}>
                    <BlurMask blur={3 * scale} style="solid" />
                </Circle>
            </Group>
            {/* below it, faintly */}
            <Group clip={ground}>{line(underground)}</Group>
        </>
    );
}

export function SkyScene({ bodies, sunAltitude, basis, declination, partner, link }: Props) {
    const palette = skyColors(sunAltitude);
    const { width, height } = useSafeAreaFrame();
    // The sky always shows the same degrees top to bottom, so on a taller screen (tablet)
    // it's bigger; fixed-size things (stars, glows, letters) grow with it.
    const k = Math.max(1, height / FRAME.height);
    const smooth = useSmoothedBasis(basis);
    const sky: SkyView = { basis: smooth, declination, width, height };
    const font = useFont(require("@/assets/fonts/PublicSans-Medium.ttf"), 16 * k);
    const smallFont = useFont(require("@/assets/fonts/PublicSans-Regular.ttf"), 11 * k);

    const shape = useDerivedValue(() => groundPolygon(smooth.value.U, width, height), [width, height]);

    // the sky gradient is anchored to the real horizon, not the screen
    const skyStart = useDerivedValue(() => vec(shape.value.horizonPoint.x, shape.value.horizonPoint.y));
    const skyEnd = useDerivedValue(() => vec(shape.value.skyHigh.x, shape.value.skyHigh.y));

    const groundPath = useDerivedValue(() => {
        const p = Skia.Path.Make();
        const g = shape.value.ground;
        if (g.length > 2) {
            p.moveTo(g[0][0], g[0][1]);
            for (let i = 1; i < g.length; i++) p.lineTo(g[i][0], g[i][1]);
            p.close();
        }
        return p;
    });
    // the ground fades from the horizon down
    const groundFade = useDerivedValue(() => {
        const { horizon, groundDir } = shape.value;
        const from = horizon.length === 2
            ? { x: (horizon[0][0] + horizon[1][0]) / 2, y: (horizon[0][1] + horizon[1][1]) / 2 }
            : { x: width / 2, y: height / 2 };
        return { from, to: { x: from.x + groundDir.x * GROUND_FADE_PX, y: from.y + groundDir.y * GROUND_FADE_PX } };
    }, [width, height]);
    const groundStart = useDerivedValue(() => vec(groundFade.value.from.x, groundFade.value.from.y));
    const groundEnd = useDerivedValue(() => vec(groundFade.value.to.x, groundFade.value.to.y));

    const horizonLine = useDerivedValue(() => {
        const p = Skia.Path.Make();
        const h = shape.value.horizon;
        if (h.length === 2) p.moveTo(h[0][0], h[0][1]).lineTo(h[1][0], h[1][1]);
        return p;
    });

    // the whole grid as one path; points behind you would flip across the screen, so
    // lines are split there
    const grid = useDerivedValue(() => {
        const at = projector(smooth.value, declination, width, height);
        const p = Skia.Path.Make();
        for (const line of GRID_LINES) {
            let drawing = false;
            for (const { bearing, altitude } of line) {
                const s = at(bearing, altitude);
                if (s.angleFromCenter >= IN_FRONT_DEG) drawing = false;
                else if (drawing) p.lineTo(s.x, s.y);
                else {
                    p.moveTo(s.x, s.y);
                    drawing = true;
                }
            }
        }
        return p;
    }, [declination, width, height]);

    const night = Math.min(1, Math.max(0, sunAltitude / FULL_NIGHT_SUN_ALTITUDE));
    const linkBody = link ? bodies.find((b) => b.name === link.to) : undefined;

    return (
        // full screen, so the sky maths match the screen
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Canvas style={StyleSheet.absoluteFill}>
                <Rect x={0} y={0} width={width} height={height}>
                    <LinearGradient
                        start={skyStart} end={skyEnd}
                        colors={palette.stops.map((s) => s.color)} positions={palette.stops.map((s) => s.offset)}
                    />
                </Rect>

                <Stars sky={sky} night={night} scale={k} />
                <ShootingStars sky={sky} active={night >= SHOOTING_STARS_FROM} scale={k} />

                <Path path={grid} style="stroke" strokeWidth={1} color={COLORS.grid} opacity={GRID_OPACITY} />

                {/* in front of the grid, behind the sun/moon */}
                <Clouds sky={sky} color={palette.cloud} opacity={palette.cloudOpacity} bodies={bodies} />

                {/* drawn before the ground, so a setting sun/moon sinks behind it */}
                {bodies.map((body) => body.phase
                    ? <Moon key={body.name} sky={sky} body={body} phase={body.phase} scale={k} />
                    : <Sun key={body.name} sky={sky} body={body} scale={k} />)}

                <Path path={groundPath}>
                    <LinearGradient start={groundStart} end={groundEnd} colors={[palette.ground, COLORS.groundFar]} />
                </Path>
                <Path path={horizonLine} style="stroke" strokeWidth={1} color={palette.labels} opacity={0.35} />

                {partner && (
                    <PartnerLink
                        sky={sky} ground={groundPath} scale={k} together={!!link?.together}
                        from={{ bearing: partner.bearing, altitude: MARKER_ALTITUDE }}
                        to={linkBody ? {
                            bearing: linkBody.bearing, altitude: linkBody.altitude,
                            glow: (linkBody.name === "sun" ? SUN_GLOW : MOON_GLOW) * k,
                        } : null}
                    />
                )}
                {partner && <PartnerMarker sky={sky} bearing={partner.bearing} km={partner.km} font={smallFont} scale={k} />}

                {bodies.filter((body) => body.altitude < 0).map((body) => (
                    <BelowHorizonRing key={body.name} sky={sky} body={body} scale={k} />
                ))}

                {font && CARDINALS.map(({ label, bearing }) => (
                    <Cardinal
                        key={label} sky={sky} label={label} bearing={bearing} font={font} scale={k}
                        color={label === "N" ? palette.north : palette.labels}
                    />
                ))}
            </Canvas>
        </View>
    );
}
