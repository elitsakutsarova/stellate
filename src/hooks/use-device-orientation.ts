import { useEffect, useRef, useState } from "react";
import { useSharedValue } from "react-native-reanimated";
import { Accelerometer, Magnetometer } from "expo-sensors";
import * as Location from "expo-location";
import { basisLookingAt, type SkyPoint } from "@/hooks/use-sky-bodies";

export type Vec3 = { x: number; y: number; z: number };
export type Basis = { E: Vec3; N: Vec3; U: Vec3 };

// "worklet": also used on the UI thread, where the sky eases towards the sensors.
export function normalize(v: Vec3): Vec3 {
    "worklet";
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}
function cross(a: Vec3, b: Vec3): Vec3 {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
export function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
    "worklet";
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

// Builds magnetic east/north/up (in device axes: x right, y up the screen, z out of
// the screen) from raw gravity + magnetic field - a tilt-compensated compass that
// works at any angle. DeviceMotion.rotation isn't used: its Euler angles follow
// different conventions on iOS and Android.
function computeBasis(gravity: Vec3, magnetic: Vec3): Basis {
    const U = normalize(gravity);
    const E = normalize(cross(magnetic, gravity));
    const N = normalize(cross(gravity, E));
    return { E, N, U };
}

// E/N/U: magnetic east/north/up in device axes; declination converts to true north.
// The heading watcher waits for location permission, since it would otherwise
// trigger its own system prompt.
// ~30 readings/s; each moves this fraction of the way to the new value.
const SENSOR_INTERVAL_MS = 33;
const GRAVITY_SMOOTHING = 0.1;
const MAGNETIC_SMOOTHING = 0.06;

// basis is a shared value, not state: it changes ~30 times a second, and only the sky
// drawing (on the UI thread) needs it - so the screen doesn't re-render for it.
// lookAt (debug): pretend the phone points straight at this spot instead.
export function useDeviceOrientation(hasLocationPermission: boolean, lookAt: SkyPoint | null = null) {
    const basis = useSharedValue<Basis>(computeBasis({ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: -1 }));
    const [declination, setDeclination] = useState(0);
    const [ready, setReady] = useState(false); // both sensors have given a first reading
    const readyRef = useRef(false);
    const overrideRef = useRef(false);
    overrideRef.current = !!lookAt;

    useEffect(() => {
        if (lookAt) basis.value = basisLookingAt(lookAt.bearing, lookAt.altitude, declination);
    }, [lookAt?.bearing, lookAt?.altitude, declination, basis]);

    const gravity = useRef<Vec3>({ x: 0, y: 0, z: 1 });
    const magnetic = useRef<Vec3>({ x: 0, y: 1, z: -1 });
    const declinationRef = useRef(0);
    // The made-up starts above are only placeholders: each sensor's first reading
    // replaces them outright, or the sky would visibly swing from them into place.
    const hasGravity = useRef(false);
    const hasMagnetic = useRef(false);

    useEffect(() => {
        if (!hasLocationPermission) return;
        let sub: Location.LocationSubscription | undefined;
        let first = true;
        (async () => {
            sub = await Location.watchHeadingAsync((h) => {
                if (h.trueHeading < 0) return;
                const wanted = ((h.trueHeading - h.magHeading + 540) % 360) - 180;
                declinationRef.current = first ? wanted : declinationRef.current + (wanted - declinationRef.current) * 0.1;
                first = false;
                // rounded, so tiny changes don't re-render the screen
                setDeclination(Math.round(declinationRef.current * 10) / 10);
            });
        })();
        return () => sub?.remove();
    }, [hasLocationPermission]);

    function recompute() {
        if (!overrideRef.current) basis.value = computeBasis(gravity.current, magnetic.current);
        if (!readyRef.current && hasGravity.current && hasMagnetic.current) {
            readyRef.current = true;
            setReady(true);
        }
    }

    useEffect(() => {
        Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);
        const sub = Accelerometer.addListener(({ x, y, z }) => {
            // The accelerometer reports gravity (pointing down); negate so it means "up".
            const up = { x: -x, y: -y, z: -z };
            gravity.current = hasGravity.current ? lerpVec(gravity.current, up, GRAVITY_SMOOTHING) : up;
            hasGravity.current = true;
            recompute();
        });
        return () => sub.remove();
    }, []);

    useEffect(() => {
        Magnetometer.setUpdateInterval(SENSOR_INTERVAL_MS);
        const sub = Magnetometer.addListener(({ x, y, z }) => {
            // Noisier than the accelerometer, so smoothed harder. No recompute() here - the
            // accelerometer already recomputes at the same rate.
            magnetic.current = hasMagnetic.current ? lerpVec(magnetic.current, { x, y, z }, MAGNETIC_SMOOTHING) : { x, y, z };
            hasMagnetic.current = true;
        });
        return () => sub.remove();
    }, []);

    return { basis, declination, ready };
}
