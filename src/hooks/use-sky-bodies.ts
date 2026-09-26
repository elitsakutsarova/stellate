import { useEffect, useState } from "react";
/* import SunCalc from "suncalc"; */
import type { Vec3 } from "./use-device-orientation";

const SunCalc = require("suncalc");
type Body = { altitude: number; bearing: number; visible: boolean };
// visible here = above the horizon
export type SkyBody = Body & { name: "sun" | "moon" };

// Degrees of sky the screen shows from top to bottom (roughly a phone camera
// in portrait) — tune this to taste. Left/right follows from the screen's
// shape, because both directions use the same scale (like a photo), so the
// sky is never stretched and the sun/moon stay round.
const FOV_VERTICAL = 70;

// pixels per unit of "sideways / forward" — one number for both x and y
export const focalPx = (height: number) => height / 2 / Math.tan((FOV_VERTICAL / 2) * (Math.PI / 180));

function targetVector(azimuthDeg: number, altitudeDeg: number): Vec3 {
    const az = azimuthDeg * (Math.PI / 180);
    const alt = altitudeDeg * (Math.PI / 180);
    return { x: Math.sin(az) * Math.cos(alt), y: Math.cos(az) * Math.cos(alt), z: Math.sin(alt) };
}

// Projects a target's real-world (bearing, altitude) into screen space
// through the device's actual attitude — E/N/U from useDeviceOrientation,
// the device-local directions of magnetic east/north/up — rather than a
// flat az/alt-to-x/y mapping. This is what makes rolling the phone (tilting
// it sideways) rotate the sky correctly, like looking through a real
// window, and keeps working right up to the zenith. declination converts
// the target's true bearing to the magnetic bearing E/N/U are relative to.
export function projectToScreen(
    E: Vec3, N: Vec3, U: Vec3, declination: number,
    targetBearing: number, targetAltitude: number,
    width: number, height: number
) {
    const t = targetVector(targetBearing - declination, targetAltitude);
    // t is in world (east, north, up) coordinates; re-express it in the
    // device's own axes by projecting onto E/N/U.
    const dx = t.x * E.x + t.y * N.x + t.z * U.x;
    const dy = t.x * E.y + t.y * N.y + t.z * U.y;
    const dz = t.x * E.z + t.y * N.z + t.z * U.z;

    // "Forward" is the direction the screen face points, not the back of
    // the phone — confirmed by holding the phone with the screen aimed at
    // the real sun (local (0,0,1) rather than (0,0,-1)). Right and up both
    // flip sign along with it — confirmed on-device: with only forward+right
    // flipped, left/right tracked correctly but tilting up/down was inverted,
    // so up needs the flip too.
    const xCam = -dx;
    const yCam = -dy;
    const zCam = dz;

    // total angle between where the phone points and the target — used
    // for visibility and as a roll-aware stand-in for "how aligned are we"
    const angleFromCenter = (Math.acos(Math.min(1, Math.max(-1, zCam))) * 180) / Math.PI;

    const depth = zCam > 0.001 ? zCam : 0.001;
    const f = focalPx(height);
    const x = width / 2 + (xCam / depth) * f;
    const y = height / 2 - (yCam / depth) * f;

    // A compass arrow at the screen border: cast a ray from the center in
    // the direction of (dRight, dUp) and find where it hits the (inset)
    // screen rectangle — not a circle, so it reaches all the way to the
    // edges, including the corners. Driven purely by that direction (not
    // the FOV-based x/y above), so it stays well-behaved even directly
    // behind you, where the perspective-divided x/y blow up or flip sign.
    const arrowAngleRad = Math.atan2(xCam, yCam);
    const dirX = Math.sin(arrowAngleRad);
    const dirY = -Math.cos(arrowAngleRad);
    const arrowMargin = 24;
    const halfW = width / 2 - arrowMargin;
    const halfH = height / 2 - arrowMargin;
    const tX = dirX !== 0 ? halfW / Math.abs(dirX) : Infinity;
    const tY = dirY !== 0 ? halfH / Math.abs(dirY) : Infinity;
    const rayDist = Math.min(tX, tY);
    const arrowX = width / 2 + dirX * rayDist;
    const arrowY = height / 2 + dirY * rayDist;

    return {
        x, y,
        // actually inside the screen rectangle (and in front of you, not
        // behind) — "on screen" means exactly what you can see
        visible: zCam > 0 && x >= 0 && x <= width && y >= 0 && y <= height,
        angleFromCenter,
        arrowX, arrowY,
        arrowDeg: (arrowAngleRad * 180) / Math.PI,
        // screen-relative direction to the target, for the off-screen hint —
        // signs only, roll-correct (unlike a raw compass-bearing diff)
        dRight: xCam,
        dUp: yCam,
    };
}

// Where the ground is on screen. The horizon is a flat circle around you, and
// a perspective view always turns a flat circle through your eye into a
// straight line — so "above or below the horizon" is a simple linear test per
// screen point: aboveHorizon(x, y) > 0 is sky, < 0 is ground. Built from the
// same camera maths as projectToScreen (xCam = -dx, yCam = -dy, zCam = dz),
// applied to world "up".
export function groundPolygon(U: Vec3, width: number, height: number) {
    const up = { x: -U.x, y: -U.y, z: U.z }; // world up, in camera coords
    const kx = focalPx(height);
    const ky = kx; // same scale both ways, matching projectToScreen
    const aboveHorizon = (x: number, y: number) =>
        (up.x * (x - width / 2)) / kx - (up.y * (y - height / 2)) / ky + up.z;

    // Walk the screen's 4 corners, keeping the ground ones and adding the
    // point where each edge crosses the horizon (clipping the screen
    // rectangle against the horizon line).
    const corners = [[0, 0], [width, 0], [width, height], [0, height]];
    const ground: number[][] = [];
    const horizon: number[][] = [];
    corners.forEach(([x1, y1], i) => {
        const [x2, y2] = corners[(i + 1) % 4];
        const a = aboveHorizon(x1, y1);
        const b = aboveHorizon(x2, y2);
        if (a < 0) ground.push([x1, y1]);
        if (a < 0 !== b < 0) {
            const t = a / (a - b);
            const crossing = [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
            ground.push(crossing);
            horizon.push(crossing);
        }
    });
    // screen direction pointing "down into the ground", perpendicular to the
    // horizon — lets the ground fade in from the horizon instead of being a
    // flat wall. It's the opposite of aboveHorizon's slope (a, b).
    const a = up.x / kx;
    const b = -up.y / ky;
    const len = Math.hypot(a, b) || 1;
    const groundDir = { x: -a / len, y: -b / len };
    return { ground, horizon, groundDir };
}

// The reverse of projectToScreen: a made-up E/N/U for a phone aimed exactly
// at (bearing, altitude) with the horizon level — so projectToScreen puts
// that target dead centre. Development only: lets a device with poor
// sensors (e.g. a tablet) test everything that happens once you're
// "looking". Written in the same camera convention projectToScreen uses
// (xCam = -dx, yCam = -dy, zCam = dz), so the two always agree.
export function basisLookingAt(bearing: number, altitude: number, declination: number) {
    const f = targetVector(bearing - declination, altitude); // forward, in world (east, north, up)
    // "up on screen" = world up with the forward part removed; straight
    // overhead there is no such direction, so fall back to north
    const worldUp = Math.abs(f.z) > 0.999 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
    const d = worldUp.x * f.x + worldUp.y * f.y + worldUp.z * f.z;
    const upLen = Math.hypot(worldUp.x - d * f.x, worldUp.y - d * f.y, worldUp.z - d * f.z);
    const up = { x: (worldUp.x - d * f.x) / upLen, y: (worldUp.y - d * f.y) / upLen, z: (worldUp.z - d * f.z) / upLen };
    const right = { x: f.y * up.z - f.z * up.y, y: f.z * up.x - f.x * up.z, z: f.x * up.y - f.y * up.x }; // f × up

    // device axes in world coords (negated to match xCam = -dx, yCam = -dy)
    const xAxis = { x: -right.x, y: -right.y, z: -right.z };
    const yAxis = { x: -up.x, y: -up.y, z: -up.z };
    const zAxis = f;
    // E/N/U are the same numbers read the other way: world east/north/up
    // expressed in device axes
    return {
        E: { x: xAxis.x, y: yAxis.x, z: zAxis.x },
        N: { x: xAxis.y, y: yAxis.y, z: zAxis.y },
        U: { x: xAxis.z, y: yAxis.z, z: zAxis.z },
    };
}

// where the sun and moon actually are, recalculated every 30s - even though they move slowly, this is to keep the display accurate and in sync with the real world
// bearing is a compass heading: 0=north, 90=east, 180=south, 270=west

// The installed suncalc (2.0.2) already returns azimuth/altitude in degrees,
// with azimuth already a standard compass bearing (0=north, clockwise) — not
// the old "radians, 0=south" API some docs/examples still describe. No
// conversion needed; empirically verified against the installed package.

export function useSkyBodies(coords: { latitude: number; longitude: number } | null) {
    const [sun, setSun] = useState<Body | null>(null);
    const [moon, setMoon] = useState<Body | null>(null);

    useEffect(() => {
        if (!coords) return;
        // TypeScript can't tell the check above still holds inside
        // recompute() (it runs later, on a timer), so give it a plain const
        const { latitude, longitude } = coords;

        function recompute() {
            const now = new Date();
            const sunPos = SunCalc.getPosition(now, latitude, longitude);
            const moonPos = SunCalc.getMoonPosition(now, latitude, longitude);

            setSun({
                altitude: sunPos.altitude,
                bearing: sunPos.azimuth,
                visible: sunPos.altitude > 0,
            });
            setMoon({
                altitude: moonPos.altitude,
                bearing: moonPos.azimuth,
                visible: moonPos.altitude > 0,
            });
        }

        recompute();
        const interval = setInterval(recompute, 30_000);
        return () => clearInterval(interval);
    }, [coords]);

    const sunBody: SkyBody | null = sun && { name: "sun", ...sun };
    const moonBody: SkyBody | null = moon && { name: "moon", ...moon };
    // Both are always somewhere in the sky sphere (above or below the
    // horizon), and you can look at either one.
    const bodies = [sunBody, moonBody].filter((b): b is SkyBody => b !== null);

    // The "main" one the arrow guides you to: prefer the sun when it's up;
    // fall back to the moon; if neither is up, whichever is closer to the
    // horizon (about to rise).
    const active =
        sunBody?.visible ? sunBody :
            moonBody?.visible ? moonBody :
                sunBody && moonBody
                    ? (sunBody.altitude > moonBody.altitude ? sunBody : moonBody)
                    : null;

    return { bodies, active };
}