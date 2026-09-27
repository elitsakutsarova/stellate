import { useEffect, useState } from "react";
import { Circle, createPicture, Group, Line, LinearGradient, Path, Picture, Skia, TileMode, vec } from "@shopify/react-native-skia";
import {
    cancelAnimation, Easing, useDerivedValue, useSharedValue, withDelay, withRepeat, withSequence, withTiming, type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { focalPx, projector, type SkyPoint } from "@/hooks/use-sky-bodies";
import type { Basis } from "@/hooks/use-device-orientation";

// Decorative things placed in the sky (stars, clouds, shooting stars), drawn with Skia.
// Every frame is worked out on the UI thread from the phone's attitude (a shared
// value), so React doesn't re-render while you move.

// What each piece needs to place itself on screen.
export type SkyView = { basis: SharedValue<Basis>; declination: number; width: number; height: number };

// further than this from the centre = behind you (would project upside down)
export const IN_FRONT_DEG = 80;

// Fixed seed, so it's the same sky every time.
function seededRandom(seed: number) {
    // mulberry32
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---- stars ----

const STAR_LEVELS = [0.4, 0.6, 0.8]; // brightness groups...
const TWINKLE_GROUPS = 2;            // ...each split in two that twinkle out of step
const TWINKLE_LOW = 0.55;            // how far a star dims at the bottom of a twinkle
const TWINKLE_MS = [1200, 2600];     // random length of half a twinkle, per group
const starRandom = seededRandom(42);
const STARS = Array.from({ length: 150 }, () => ({
    bearing: starRandom() * 360,
    // asin spreads them evenly over the dome
    altitude: (Math.asin(starRandom()) * 180) / Math.PI,
    radius: 0.6 + starRandom() * 1.0,
    level: Math.floor(starRandom() * STAR_LEVELS.length),
}));
// by index, not random, so the stars stay exactly where they were
const STAR_GROUPS = STAR_LEVELS.flatMap((opacity, level) => Array.from({ length: TWINKLE_GROUPS }, (_, twinkle) => ({
    opacity,
    stars: STARS.filter((s, i) => s.level === level && i % TWINKLE_GROUPS === twinkle),
})));

function StarGroup({ sky, stars, opacity, scale }: {
    sky: SkyView; stars: typeof STARS; opacity: number; scale: number;
}) {
    const { basis, declination, width, height } = sky;
    const path = useDerivedValue(() => {
        const at = projector(basis.value, declination, width, height);
        const p = Skia.Path.Make();
        for (const star of stars) {
            const s = at(star.bearing, star.altitude);
            if (s.visible) p.addCircle(s.x, s.y, star.radius * scale);
        }
        return p;
    }, [declination, width, height, stars, scale]);

    // slowly dims and brightens forever, at its own pace and starting point
    const twinkle = useSharedValue(1);
    useEffect(() => {
        const [min, max] = TWINKLE_MS;
        const half = min + Math.random() * (max - min);
        const ease = { duration: half, easing: Easing.inOut(Easing.sin) };
        twinkle.value = withDelay(
            Math.random() * half,
            withRepeat(withSequence(withTiming(TWINKLE_LOW, ease), withTiming(1, ease)), -1)
        );
        return () => cancelAnimation(twinkle);
    }, [twinkle]);
    const shown = useDerivedValue(() => opacity * twinkle.value, [opacity]);

    return <Path path={path} color="#FFFFFF" opacity={shown} />;
}

// night: 0 = none, 1 = all out. scale: bigger on tablets.
export function Stars({ sky, night, scale }: { sky: SkyView; night: number; scale: number }) {
    if (night <= 0) return null;
    return (
        <>
            {STAR_GROUPS.map(({ opacity, stars }, i) => (
                <StarGroup key={i} sky={sky} stars={stars} opacity={opacity * night} scale={scale} />
            ))}
        </>
    );
}

// ---- clouds ----

// Clouds are built from soft puffs: glows that fade to nothing at the edge, stretched
// sideways, so overlaps blend into one fluffy shape. Sizes are in degrees of sky, so
// they scale with the screen like the grid does.
type Puff = {
    along: number;    // -1 (left end) to 1 (right end) of the cloud
    lift: number;     // degrees above the cloud's base
    radius: number;   // degrees, the puff's height
    stretch: number;  // width / height
};

const cloudRandom = seededRandom(7);
const between = (min: number, max: number) => min + cloudRandom() * (max - min);

// Cumulus: billows in a dome, bigger and higher in the middle. Their bottoms only
// roughly line up, so the base is soft and uneven.
function cumulus(halfWidth: number): Puff[] {
    return Array.from({ length: 6 + Math.floor(cloudRandom() * 4) }, () => {
        const along = between(-0.85, 0.85);
        const dome = Math.sqrt(1 - along * along); // 1 in the middle, lower to the sides
        const radius = halfWidth * (0.2 + 0.22 * dome) * between(0.8, 1.2);
        return { along, lift: radius * between(0.6, 1) + halfWidth * 0.12 * dome, radius, stretch: between(1.2, 1.6) };
    });
}

// Tower: a narrow cloud of billows stacked up, getting smaller towards the top.
function tower(halfWidth: number): Puff[] {
    const levels = 3 + Math.floor(cloudRandom() * 2);
    return Array.from({ length: levels * 2 }, (_, i) => {
        const level = Math.floor(i / 2) / levels; // 0 at the bottom
        const radius = halfWidth * (0.45 - 0.2 * level) * between(0.85, 1.15);
        return {
            along: between(-0.35, 0.35) * (1 - level * 0.5), lift: level * halfWidth * 1.3 + radius, radius,
            stretch: between(1.1, 1.3),
        };
    });
}

// Patch: a small, loose cloud of a few puffs, close enough to merge (not dots).
function patch(halfWidth: number): Puff[] {
    return Array.from({ length: 4 + Math.floor(cloudRandom() * 3) }, () => ({
        along: between(-0.7, 0.7), lift: between(0, halfWidth * 0.25), radius: halfWidth * between(0.2, 0.28),
        stretch: between(1.3, 1.6),
    }));
}

// Wisp: a long, thin, faint streak, slightly slanted. Puffs are evenly spaced so they
// always overlap into one streak, and thinner towards the ends.
function wisp(halfWidth: number): Puff[] {
    const slant = between(-0.15, 0.15);
    const count = 5 + Math.floor(cloudRandom() * 3);
    return Array.from({ length: count }, (_, i) => {
        const along = (i / (count - 1)) * 2 - 1 + between(-0.08, 0.08);
        const taper = 0.6 + 0.4 * (1 - along * along);
        return {
            along, lift: along * slant * halfWidth,
            radius: halfWidth * between(0.12, 0.16) * taper, stretch: between(2.5, 3.5),
        };
    });
}

// How many of each, where they sit (degrees above the horizon, half-width) and how
// solid (0-1).
const CLOUD_KINDS = [
    { make: cumulus, count: 7, altitude: [10, 35], halfWidth: [6, 11], strength: 1 },
    { make: tower, count: 2, altitude: [8, 20], halfWidth: [4, 6], strength: 1 },
    { make: patch, count: 1, altitude: [20, 40], halfWidth: [5, 7], strength: 0.8 },
    { make: wisp, count: 3, altitude: [28, 55], halfWidth: [10, 16], strength: 0.6 },
];

// Random directions, but at least this far apart, so they can't pile up in one place.
const MIN_CLOUD_GAP = 18;
const taken: number[] = [];
const freeBearing = () => {
    let bearing = cloudRandom() * 360;
    for (let tries = 0; tries < 50 && taken.some((b) => Math.abs(((bearing - b + 540) % 360) - 180) < MIN_CLOUD_GAP); tries++) {
        bearing = cloudRandom() * 360;
    }
    taken.push(bearing);
    return bearing;
};

const CLOUDS = CLOUD_KINDS.flatMap((kind) => Array<typeof kind>(kind.count).fill(kind)).map((kind) => {
    const altitude = between(kind.altitude[0], kind.altitude[1]);
    const halfWidth = between(kind.halfWidth[0], kind.halfWidth[1]);
    const bearing = freeBearing();
    // a degree of bearing gets narrower higher up, so widen it to keep the shape
    const widen = 1 / Math.cos((altitude * Math.PI) / 180);
    const puffs = kind.make(halfWidth).map(({ along, lift, ...puff }) => ({
        ...puff,
        bearing: bearing + along * halfWidth * widen,
        altitude: altitude + lift,
        widen,
        strength: kind.strength,
    }));
    return { bearing, altitude, halfWidth, puffs };
});

const PUFF_STRENGTH = 0.2; // centre opacity of one puff; overlaps add up
const BODY_CLEARANCE = 8;  // degrees kept free around the sun/moon, on top of the cloud's size
// how a puff fades from its centre (offset, opacity): eased, so no puff has an outline
const PUFF_FADE = [[0, 1], [0.35, 0.75], [0.7, 0.25], [1, 0]];

const degreesBetween = (a: SkyPoint, b: SkyPoint) => {
    const r = Math.PI / 180;
    const cos = Math.sin(a.altitude * r) * Math.sin(b.altitude * r) +
        Math.cos(a.altitude * r) * Math.cos(b.altitude * r) * Math.cos((a.bearing - b.bearing) * r);
    return Math.acos(Math.min(1, Math.max(-1, cos))) / r;
};

// "rgb(r, g, b)" -> "rgba(r, g, b, a)"
const withAlpha = (rgb: string, alpha: number) => rgb.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);

// bodies: clouds near the sun/moon aren't drawn, so they never cover them.
// All puffs are drawn into one picture each frame - far cheaper than ~100 elements.
export function Clouds({ sky, color, opacity, bodies }: { sky: SkyView; color: string; opacity: number; bodies: SkyPoint[] }) {
    const { basis, declination, width, height } = sky;
    const puffs = CLOUDS
        .filter((cloud) => bodies.every((body) => degreesBetween(cloud, body) > cloud.halfWidth * 1.6 + BODY_CLEARANCE))
        .flatMap((cloud) => cloud.puffs);
    // Made here, not in the worklet: the React Compiler moves small callbacks like this
    // out of the component, and the moved copy can't run on the UI thread.
    const colors = PUFF_FADE.map(([, alpha]) => Skia.Color(withAlpha(color, alpha * PUFF_STRENGTH * opacity)));
    const positions = PUFF_FADE.map(([offset]) => offset);

    const picture = useDerivedValue(() => createPicture((canvas) => {
        const at = projector(basis.value, declination, width, height);
        const pxPerDegree = (focalPx(height) * Math.PI) / 180;
        // one soft circle of radius 1, stretched and turned into each puff
        const paint = Skia.Paint();
        paint.setShader(Skia.Shader.MakeRadialGradient(vec(0, 0), 1, colors, positions, TileMode.Clamp));
        for (const puff of puffs) {
            const c = at(puff.bearing, puff.altitude);
            const ry = puff.radius * pxPerDegree;
            const rx = ry * puff.stretch;
            // only the ones in front of you and on screen
            if (c.angleFromCenter > IN_FRONT_DEG || c.x < -rx || c.x > width + rx || c.y < -rx || c.y > height + rx) continue;
            // which way the horizon runs here, so stretched puffs tilt with the phone
            const east = at(puff.bearing + puff.widen, puff.altitude);
            const angle = (Math.atan2(east.y - c.y, east.x - c.x) * 180) / Math.PI;
            paint.setAlphaf(puff.strength);
            canvas.save();
            canvas.translate(c.x, c.y);
            canvas.rotate(angle, 0, 0);
            canvas.scale(rx, ry);
            canvas.drawCircle(0, 0, 1, paint);
            canvas.restore();
        }
    }, Skia.XYWHRect(0, 0, width, height)), [declination, width, height, puffs, colors, positions]);

    if (opacity <= 0 || puffs.length === 0) return null;
    return <Picture picture={picture} />;
}

// ---- shooting stars ----

const SHOOT_MS = 900;
const SHOOT_DEGREES = 12;           // how far one travels
const TRAIL = 0.35;                 // tail length, as a share of the whole path
const WAIT_MS = [6000, 18000];      // random pause between two
const SPOT_TRIES = 40;              // random spots tried to find one on screen

type Flight = { bearing: number; altitude: number; dir: 1 | -1 };

// Now and then, one streaks through the part of the sky you're looking at.
export function ShootingStars({ sky, active, scale }: { sky: SkyView; active: boolean; scale: number }) {
    const { basis, declination, width, height } = sky;
    const [flight, setFlight] = useState<Flight | null>(null);
    const [round, setRound] = useState(0); // bumped to try again after finding no spot
    const progress = useSharedValue(0);

    useEffect(() => {
        if (!active || flight) return;
        const [min, max] = WAIT_MS;
        const timer = setTimeout(() => {
            const at = projector(basis.value, declination, width, height);
            for (let i = 0; i < SPOT_TRIES; i++) {
                const bearing = Math.random() * 360;
                const altitude = 15 + Math.random() * 60;
                if (at(bearing, altitude).visible) {
                    setFlight({ bearing, altitude, dir: Math.random() < 0.5 ? -1 : 1 });
                    return;
                }
            }
            setRound((r) => r + 1); // looking at the ground - wait for the next one
        }, min + Math.random() * (max - min));
        return () => clearTimeout(timer);
    }, [active, flight, round, basis, declination, width, height]);

    useEffect(() => {
        if (!flight) return;
        progress.value = 0;
        progress.value = withTiming(1, { duration: SHOOT_MS, easing: Easing.linear }, (finished) => {
            if (finished) scheduleOnRN(setFlight, null);
        });
    }, [flight, progress]);

    // head and tail on screen, plus how visible it is
    const streak = useDerivedValue(() => {
        if (!flight) return null;
        const at = projector(basis.value, declination, width, height);
        const along = (share: number) =>
            at(flight.bearing + flight.dir * SHOOT_DEGREES * share, flight.altitude - SHOOT_DEGREES * 0.6 * share);
        const t = progress.value;
        const head = along(t);
        const tail = along(Math.max(0, t - TRAIL));
        // quick fade in, fade out over the last part; hidden if it's behind you
        const fade = head.angleFromCenter > IN_FRONT_DEG ? 0 : Math.max(0, Math.min(1, t / 0.15, (1 - t) / 0.3));
        return { head: vec(head.x, head.y), tail: vec(tail.x, tail.y), fade };
    }, [flight, declination, width, height]);

    const head = useDerivedValue(() => streak.value?.head ?? vec(0, 0));
    const tail = useDerivedValue(() => streak.value?.tail ?? vec(0, 0));
    const fade = useDerivedValue(() => streak.value?.fade ?? 0);

    if (!flight) return null;
    return (
        <Group opacity={fade}>
            <Line p1={tail} p2={head} strokeWidth={1.5 * scale} strokeCap="round" style="stroke">
                <LinearGradient start={tail} end={head} colors={["rgba(255, 255, 255, 0)", "rgba(255, 255, 255, 0.9)"]} />
            </Line>
            <Circle c={head} r={1.4 * scale} color="#FFFFFF" />
        </Group>
    );
}
