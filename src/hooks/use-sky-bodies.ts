import { useEffect, useState } from "react";
/* import SunCalc from "suncalc"; */
import type { Vec3 } from "./use-device-orientation";

const SunCalc = require("suncalc");
type Body = { altitude: number; bearing: number; visible: boolean };

const FOV = 60; // degrees of view the "window" covers — tune this to taste
const FOCAL = 1 / Math.tan((FOV / 2) * (Math.PI / 180));

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
    const x = width / 2 + (xCam / depth) * FOCAL * (width / 2);
    const y = height / 2 - (yCam / depth) * FOCAL * (height / 2);

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
        // only actually in the frame, like looking through a viewfinder —
        // it should appear as it enters and disappear as it leaves, not
        // stick to the screen edge from anywhere in front of you
        visible: zCam > 0 && angleFromCenter < FOV / 2,
        angleFromCenter,
        arrowX, arrowY,
        arrowDeg: (arrowAngleRad * 180) / Math.PI,
        // screen-relative direction to the target, for the off-screen hint —
        // signs only, roll-correct (unlike a raw compass-bearing diff)
        dRight: xCam,
        dUp: yCam,
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

        function recompute() {
            const now = new Date();
            const sunPos = SunCalc.getPosition(now, coords.latitude, coords.longitude);
            const moonPos = SunCalc.getMoonPosition(now, coords.latitude, coords.longitude);

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

    // Prefer the sun when it's up; fall back to the moon; if neither is up,
    // show whichever is closer to the horizon (about to rise).
    const active =
        sun?.visible ? { name: "sun" as const, ...sun } :
            moon?.visible ? { name: "moon" as const, ...moon } :
                sun && moon
                    ? (sun.altitude > moon.altitude ? { name: "sun" as const, ...sun } : { name: "moon" as const, ...moon })
                    : null;

    return { sun, moon, active };
}