import { useEffect, useState } from "react";
import * as SunCalc from "suncalc";
import type { Basis, Vec3 } from "./use-device-orientation";

export type SkyPoint = { bearing: number; altitude: number };
// fraction: how much of the moon is lit (0 new - 1 full). sun: where the light comes
// from (left out by the debug phases, which then use waxing to pick a side).
export type MoonPhase = { fraction: number; waxing: boolean; sun?: SkyPoint };
type Body = SkyPoint & { visible: boolean; phase?: MoonPhase }; // visible = above the horizon
export type SkyBody = Body & { name: "sun" | "moon" };

// Degrees of sky shown top to bottom. x and y share one scale, so the sky isn't stretched.
const FOV_VERTICAL = 70;

export const focalPx = (height: number) => {
    "worklet";
    return height / 2 / Math.tan((FOV_VERTICAL / 2) * (Math.PI / 180));
};

function targetVector(azimuthDeg: number, altitudeDeg: number): Vec3 {
    "worklet";
    const az = azimuthDeg * (Math.PI / 180);
    const alt = altitudeDeg * (Math.PI / 180);
    return { x: Math.sin(az) * Math.cos(alt), y: Math.cos(az) * Math.cos(alt), z: Math.sin(alt) };
}

export function degreesApart(a: SkyPoint, b: SkyPoint) {
    "worklet";
    const u = targetVector(a.bearing, a.altitude);
    const v = targetVector(b.bearing, b.altitude);
    return (Math.acos(Math.min(1, Math.max(-1, u.x * v.x + u.y * v.y + u.z * v.z))) * 180) / Math.PI;
}

// The point a share `t` (0-1) of the way from a to b, along the shortest path across
// the sky (a great circle), so lines between two spots curve like the sky does.
export function pointAlong(a: SkyPoint, b: SkyPoint, t: number): SkyPoint {
    "worklet";
    const u = targetVector(a.bearing, a.altitude);
    const v = targetVector(b.bearing, b.altitude);
    const angle = (degreesApart(a, b) * Math.PI) / 180;
    if (angle < 1e-4) return a;
    const wa = Math.sin((1 - t) * angle) / Math.sin(angle);
    const wb = Math.sin(t * angle) / Math.sin(angle);
    const p = { x: wa * u.x + wb * v.x, y: wa * u.y + wb * v.y, z: wa * u.z + wb * v.z };
    return {
        bearing: (Math.atan2(p.x, p.y) * 180) / Math.PI,
        altitude: (Math.asin(Math.min(1, Math.max(-1, p.z))) * 180) / Math.PI,
    };
}

// The screen angle (degrees, 0 = right, clockwise) the moon's lit side faces: towards
// the sun, along the sky - so it's right however the phone is held. Found by projecting
// a point 1 degree from the moon towards the sun. null if the sun sits right on the
// moon (only in debug mode, where the moon is moved there).
export function towardsSun(moon: SkyPoint, sun: SkyPoint, at: (bearing: number, altitude: number) => { x: number; y: number }) {
    "worklet";
    const apart = degreesApart(moon, sun);
    // right on top of each other (or exactly opposite): no one direction
    if (apart < 1 || apart > 179) return null;
    const step = pointAlong(moon, sun, 1 / apart); // 1 degree towards the sun
    const from = at(moon.bearing, moon.altitude);
    const to = at(step.bearing, step.altitude);
    return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

// Projects a real-world (bearing, altitude) onto the screen through the phone's
// attitude (E/N/U = magnetic east/north/up in device axes), so rolling the phone
// rotates the sky correctly. declination converts true bearings to magnetic.
function projectToScreen(
    E: Vec3, N: Vec3, U: Vec3, declination: number,
    targetBearing: number, targetAltitude: number,
    width: number, height: number
) {
    "worklet";
    const t = targetVector(targetBearing - declination, targetAltitude);
    const dx = t.x * E.x + t.y * N.x + t.z * U.x;
    const dy = t.x * E.y + t.y * N.y + t.z * U.y;
    const dz = t.x * E.z + t.y * N.z + t.z * U.z;

    // Sign convention verified on-device: forward is +z, right and up are flipped.
    const xCam = -dx;
    const yCam = -dy;
    const zCam = dz;

    const angleFromCenter = (Math.acos(Math.min(1, Math.max(-1, zCam))) * 180) / Math.PI;

    const depth = zCam > 0.001 ? zCam : 0.001;
    const f = focalPx(height);
    const x = width / 2 + (xCam / depth) * f;
    const y = height / 2 - (yCam / depth) * f;

    // Edge arrow: where a ray from the centre towards the target hits the screen
    // border. Uses direction only, so it still works when the target is behind you.
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
        visible: zCam > 0 && x >= 0 && x <= width && y >= 0 && y <= height,
        angleFromCenter,
        arrowX, arrowY,
        arrowDeg: (arrowAngleRad * 180) / Math.PI,
        dRight: xCam,
        dUp: yCam,
    };
}

export function projector(basis: Basis, declination: number, width: number, height: number) {
    "worklet";
    return (bearing: number, altitude: number) =>
        projectToScreen(basis.E, basis.N, basis.U, declination, bearing, altitude, width, height);
}

// The horizon always projects to a straight line, so "sky or ground" is a linear
// test per screen point: aboveHorizon(x, y) > 0 is sky.
export function groundPolygon(U: Vec3, width: number, height: number) {
    "worklet";
    const up = { x: -U.x, y: -U.y, z: U.z }; // world up, in camera coords
    const kx = focalPx(height);
    const ky = kx;
    const aboveHorizon = (x: number, y: number) =>
        (up.x * (x - width / 2)) / kx - (up.y * (y - height / 2)) / ky + up.z;

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
    const a = up.x / kx;
    const b = -up.y / ky;
    const slope = Math.max(Math.hypot(a, b), 1e-5); // ~0 only when looking straight up/down
    const groundDir = { x: -a / slope, y: -b / slope }; // "down" on screen

    // For the sky gradient: the horizon point nearest the screen centre, and the
    // point 60 degrees above it. aboveHorizon at the centre equals sin(tilt), and
    // altitude A lands f * (tan(A - tilt) + tan(tilt)) px above the horizon.
    const centre = aboveHorizon(width / 2, height / 2);
    const horizonPoint = { x: width / 2 + groundDir.x * (centre / slope), y: height / 2 + groundDir.y * (centre / slope) };
    const tilt = Math.asin(Math.min(1, Math.max(-1, centre)));
    const deg = Math.PI / 180;
    const reach = kx * (Math.tan(Math.min(60 * deg - tilt, 85 * deg)) + Math.tan(tilt));
    const skyHigh = { x: horizonPoint.x - groundDir.x * reach, y: horizonPoint.y - groundDir.y * reach };
    return { ground, horizon, groundDir, horizonPoint, skyHigh };
}

// Debug only: a fake E/N/U for a phone aimed exactly at (bearing, altitude), in the
// same camera convention as projectToScreen.
export function basisLookingAt(bearing: number, altitude: number, declination: number) {
    const f = targetVector(bearing - declination, altitude);
    // straight overhead there's no "up" direction, so use north instead
    const worldUp = Math.abs(f.z) > 0.999 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
    const d = worldUp.x * f.x + worldUp.y * f.y + worldUp.z * f.z;
    const upLen = Math.hypot(worldUp.x - d * f.x, worldUp.y - d * f.y, worldUp.z - d * f.z);
    const up = { x: (worldUp.x - d * f.x) / upLen, y: (worldUp.y - d * f.y) / upLen, z: (worldUp.z - d * f.z) / upLen };
    const right = { x: f.y * up.z - f.z * up.y, y: f.z * up.x - f.x * up.z, z: f.x * up.y - f.y * up.x }; // f × up

    const xAxis = { x: -right.x, y: -right.y, z: -right.z };
    const yAxis = { x: -up.x, y: -up.y, z: -up.z };
    const zAxis = f;
    return {
        E: { x: xAxis.x, y: yAxis.x, z: zAxis.x },
        N: { x: xAxis.y, y: yAxis.y, z: zAxis.y },
        U: { x: xAxis.z, y: yAxis.z, z: zAxis.z },
    };
}

// suncalc 2.x already returns degrees, with azimuth as a compass bearing (0 = north).
export function useSkyBodies(coords: { latitude: number; longitude: number } | null) {
    const [sun, setSun] = useState<Body | null>(null);
    const [moon, setMoon] = useState<Body | null>(null);

    useEffect(() => {
        if (!coords) return;
        const { latitude, longitude } = coords;

        function recompute() {
            const now = new Date();
            const sunPos = SunCalc.getPosition(now, latitude, longitude);
            const moonPos = SunCalc.getMoonPosition(now, latitude, longitude);
            const illumination = SunCalc.getMoonIllumination(now);

            setSun({
                altitude: sunPos.altitude,
                bearing: sunPos.azimuth,
                visible: sunPos.altitude > 0,
            });
            setMoon({
                altitude: moonPos.altitude,
                bearing: moonPos.azimuth,
                visible: moonPos.altitude > 0,
                phase: {
                    fraction: illumination.fraction,
                    waxing: illumination.phase < 0.5, // suncalc: 0 new, 0.5 full, back to 1
                    sun: { bearing: sunPos.azimuth, altitude: sunPos.altitude },
                },
            });
        }

        recompute();
        const interval = setInterval(recompute, 30_000);
        return () => clearInterval(interval);
    }, [coords]);

    const sunBody: SkyBody | null = sun && { name: "sun", ...sun };
    const moonBody: SkyBody | null = moon && { name: "moon", ...moon };
    const bodies = [sunBody, moonBody].filter((b): b is SkyBody => b !== null);

    // The arrow's target: the sun if up, else the moon if up, else whichever is higher.
    const active =
        sunBody?.visible ? sunBody :
            moonBody?.visible ? moonBody :
                sunBody && moonBody
                    ? (sunBody.altitude > moonBody.altitude ? sunBody : moonBody)
                    : null;

    return { bodies, active };
}