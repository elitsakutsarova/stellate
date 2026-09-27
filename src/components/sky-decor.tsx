import { useEffect, useRef, useState } from "react";
import { useSafeAreaFrame } from "react-native-safe-area-context";
import { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, RadialGradient, Stop } from "react-native-svg";
import { focalPx, projectToScreen } from "@/hooks/use-sky-bodies";

// Decorative things placed in the sky (stars, clouds, shooting stars). The sky redraws
// every frame, and hundreds of separate elements made it stutter - so stars share a
// few <Path>s, and clouds only draw the puffs that are on screen.

type Project = (bearing: number, altitude: number) => ReturnType<typeof projectToScreen>;

// further than this from the centre = behind you (would project upside down)
export const IN_FRONT_DEG = 80;

// a circle as path commands, so many can share one <Path>
const circlePath = (x: number, y: number, r: number) =>
    `M${x - r},${y}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0`;

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

const STAR_LEVELS = [0.4, 0.6, 0.8]; // brightness groups, one <Path> each
const starRandom = seededRandom(42);
const STARS = Array.from({ length: 150 }, () => ({
    bearing: starRandom() * 360,
    // asin spreads them evenly over the dome
    altitude: (Math.asin(starRandom()) * 180) / Math.PI,
    radius: 0.6 + starRandom() * 1.0,
    level: Math.floor(starRandom() * STAR_LEVELS.length),
}));
const STAR_GROUPS = STAR_LEVELS.map((opacity, level) => ({ opacity, stars: STARS.filter((s) => s.level === level) }));

// night: 0 = none, 1 = all out. scale: bigger on tablets.
export function Stars({ at, night, scale }: { at: Project; night: number; scale: number }) {
    if (night <= 0) return null;
    return (
        <>
            {STAR_GROUPS.map(({ opacity, stars }, i) => {
                const d = stars
                    .map((star) => {
                        const p = at(star.bearing, star.altitude);
                        return p.visible ? circlePath(p.x, p.y, star.radius * scale) : "";
                    })
                    .join("");
                return d ? <Path key={i} d={d} fill="#FFFFFF" fillOpacity={opacity * night} /> : null;
            })}
        </>
    );
}

// ---- clouds ----

// Clouds are built from soft puffs: glows that fade to nothing at the edge, stretched
// sideways, so overlaps blend into one shape. Sizes are in degrees of sky, so they
// scale with the screen like the grid does.
type Puff = {
    along: number;    // -1 (left end) to 1 (right end) of the cloud
    lift: number;     // degrees above the cloud's base
    radius: number;   // degrees, the puff's height
    stretch: number;  // width / height
    strength: number; // 0-1, how solid
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
        return {
            along, lift: radius * between(0.6, 1) + halfWidth * 0.12 * dome, radius,
            stretch: between(1.2, 1.6), strength: 1,
        };
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
            stretch: between(1.1, 1.3), strength: 1,
        };
    });
}

// Patch: a scatter of small cotton balls.
function patch(halfWidth: number): Puff[] {
    return Array.from({ length: 6 + Math.floor(cloudRandom() * 4) }, () => ({
        along: between(-1, 1), lift: between(0, halfWidth * 0.5), radius: halfWidth * between(0.1, 0.18),
        stretch: between(1.3, 1.7), strength: 0.8,
    }));
}

// Wisp: a long, thin, faint streak, slightly slanted.
function wisp(halfWidth: number): Puff[] {
    const slant = between(-0.15, 0.15);
    return Array.from({ length: 3 + Math.floor(cloudRandom() * 3) }, () => {
        const along = between(-1, 1);
        return {
            along, lift: along * slant * halfWidth, radius: halfWidth * between(0.1, 0.18),
            stretch: between(3.5, 5), strength: 0.6,
        };
    });
}

// how many of each, and where they sit (degrees above the horizon, half-width)
const CLOUD_KINDS = [
    { make: cumulus, count: 6, altitude: [10, 35], halfWidth: [6, 11] },
    { make: tower, count: 2, altitude: [8, 20], halfWidth: [4, 6] },
    { make: patch, count: 3, altitude: [25, 50], halfWidth: [7, 12] },
    { make: wisp, count: 5, altitude: [28, 55], halfWidth: [10, 18] },
];

const CLOUDS = CLOUD_KINDS.flatMap((kind) => Array.from({ length: kind.count }, () => ({
    make: kind.make, altitude: between(kind.altitude[0], kind.altitude[1]), halfWidth: between(kind.halfWidth[0], kind.halfWidth[1]),
}))).map(({ altitude, halfWidth, make }) => {
    const bearing = cloudRandom() * 360;
    // a degree of bearing gets narrower higher up, so widen it to keep the shape
    const widen = 1 / Math.cos((altitude * Math.PI) / 180);
    const puffs = make(halfWidth).map(({ along, lift, ...puff }) => ({
        ...puff,
        bearing: bearing + along * halfWidth * widen,
        altitude: altitude + lift,
        widen,
    }));
    return { bearing, altitude, halfWidth, puffs };
});

const PUFF_STRENGTH = 0.2; // centre opacity of one puff; overlaps add up
const BODY_CLEARANCE = 8;  // degrees kept free around the sun/moon, on top of the cloud's size

type SkyPoint = { bearing: number; altitude: number };

const degreesBetween = (a: SkyPoint, b: SkyPoint) => {
    const r = Math.PI / 180;
    const cos = Math.sin(a.altitude * r) * Math.sin(b.altitude * r) +
        Math.cos(a.altitude * r) * Math.cos(b.altitude * r) * Math.cos((a.bearing - b.bearing) * r);
    return Math.acos(Math.min(1, Math.max(-1, cos))) / r;
};

// bodies: clouds near the sun/moon aren't drawn, so they never cover them.
export function Clouds({ at, color, opacity, bodies }: { at: Project; color: string; opacity: number; bodies: SkyPoint[] }) {
    const { width, height } = useSafeAreaFrame();
    if (opacity <= 0) return null;
    const pxPerDegree = (focalPx(height) * Math.PI) / 180;
    const puffs = CLOUDS
        .filter((cloud) => bodies.every((body) => degreesBetween(cloud, body) > cloud.halfWidth * 1.6 + BODY_CLEARANCE))
        .flatMap((cloud, c) => cloud.puffs.map((puff, i) => {
            const p = at(puff.bearing, puff.altitude);
            // which way the horizon runs here, so stretched puffs tilt with the phone
            const east = at(puff.bearing + puff.widen, puff.altitude);
            return {
                key: `${c}-${i}`,
                p,
                ry: puff.radius * pxPerDegree,
                rx: puff.radius * puff.stretch * pxPerDegree,
                angle: (Math.atan2(east.y - p.y, east.x - p.x) * 180) / Math.PI,
                strength: puff.strength,
            };
        }))
        // only the ones in front of you and on screen
        .filter(({ p, rx }) =>
            p.angleFromCenter < IN_FRONT_DEG &&
            p.x > -rx && p.x < width + rx && p.y > -rx && p.y < height + rx);
    if (puffs.length === 0) return null;
    const stop = (offset: number, strength: number) =>
        <Stop offset={offset} stopColor={color} stopOpacity={strength * PUFF_STRENGTH * opacity} />;
    return (
        <>
            <Defs>
                {/* eased fade to the edge, so no puff has an outline */}
                <RadialGradient id="cloud-puff">
                    {stop(0, 1)}
                    {stop(0.35, 0.75)}
                    {stop(0.7, 0.25)}
                    {stop(1, 0)}
                </RadialGradient>
            </Defs>
            {puffs.map(({ key, p, rx, ry, angle, strength }) => (
                <Ellipse
                    key={key} cx={p.x} cy={p.y} rx={rx} ry={ry}
                    rotation={angle} origin={`${p.x}, ${p.y}`}
                    fill="url(#cloud-puff)" opacity={strength}
                />
            ))}
        </>
    );
}

// ---- shooting stars ----

const SHOOT_MS = 900;
const SHOOT_DEGREES = 12;           // how far one travels
const TRAIL = 0.35;                 // tail length, as a share of the whole path
const WAIT_MS = [6000, 18000];      // random pause between two
const SPOT_TRIES = 40;              // random spots tried to find one on screen

type Flight = { bearing: number; altitude: number; dir: 1 | -1; elapsed: number };

// Now and then, one streaks through the part of the sky you're looking at.
// Its own component, so only it redraws while it flies.
export function ShootingStars({ at, active, scale }: { at: Project; active: boolean; scale: number }) {
    const [flight, setFlight] = useState<Flight | null>(null);
    const [round, setRound] = useState(0); // bumped to try again after finding no spot
    const atRef = useRef(at);
    atRef.current = at;

    useEffect(() => {
        if (!active || flight) return;
        const [min, max] = WAIT_MS;
        const timer = setTimeout(() => {
            for (let i = 0; i < SPOT_TRIES; i++) {
                const bearing = Math.random() * 360;
                const altitude = 15 + Math.random() * 60;
                if (atRef.current(bearing, altitude).visible) {
                    setFlight({ bearing, altitude, dir: Math.random() < 0.5 ? -1 : 1, elapsed: 0 });
                    return;
                }
            }
            setRound((r) => r + 1); // looking at the ground - wait for the next one
        }, min + Math.random() * (max - min));
        return () => clearTimeout(timer);
    }, [active, flight, round]);

    const flying = !!flight;
    useEffect(() => {
        if (!flying) return;
        const start = Date.now();
        let frame: number;
        const loop = () => {
            const elapsed = Date.now() - start;
            if (elapsed >= SHOOT_MS) return setFlight(null);
            setFlight((f) => f && { ...f, elapsed });
            frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frame);
    }, [flying]);

    if (!flight) return null;
    const progress = flight.elapsed / SHOOT_MS;
    const along = (share: number) =>
        at(flight.bearing + flight.dir * SHOOT_DEGREES * share, flight.altitude - SHOOT_DEGREES * 0.6 * share);
    const head = along(progress);
    const tail = along(Math.max(0, progress - TRAIL));
    if (head.angleFromCenter > IN_FRONT_DEG) return null;
    // quick fade in, fade out over the last part
    const fade = Math.min(1, progress / 0.15, (1 - progress) / 0.3);

    return (
        <G opacity={fade}>
            <Defs>
                <LinearGradient id="shooting-star" gradientUnits="userSpaceOnUse" x1={tail.x} y1={tail.y} x2={head.x} y2={head.y}>
                    <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
                    <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0.9" />
                </LinearGradient>
            </Defs>
            <Line
                x1={tail.x} y1={tail.y} x2={head.x} y2={head.y}
                stroke="url(#shooting-star)" strokeWidth={1.5 * scale} strokeLinecap="round"
            />
            <Circle cx={head.x} cy={head.y} r={1.4 * scale} fill="#FFFFFF" />
        </G>
    );
}
