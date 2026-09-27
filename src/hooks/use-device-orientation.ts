import { useEffect, useRef, useState } from "react";
import { Accelerometer, Magnetometer } from "expo-sensors";
import * as Location from "expo-location";

export type Vec3 = { x: number; y: number; z: number };

export function normalize(v: Vec3): Vec3 {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}
function cross(a: Vec3, b: Vec3): Vec3 {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
export function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

// Builds magnetic east/north/up (in device axes: x right, y up the screen, z out of
// the screen) from raw gravity + magnetic field - a tilt-compensated compass that
// works at any angle. DeviceMotion.rotation isn't used: its Euler angles follow
// different conventions on iOS and Android.
function computeBasis(gravity: Vec3, magnetic: Vec3) {
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

export function useDeviceOrientation(hasLocationPermission: boolean) {
    const [basis, setBasis] = useState(() => computeBasis({ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: -1 }));
    const [azimuth, setAzimuth] = useState(0);
    const [altitude, setAltitude] = useState(0);
    const [declination, setDeclination] = useState(0);

    const gravity = useRef<Vec3>({ x: 0, y: 0, z: 1 });
    const magnetic = useRef<Vec3>({ x: 0, y: 1, z: -1 });
    const declinationRef = useRef(0);

    useEffect(() => {
        if (!hasLocationPermission) return;
        let sub: Location.LocationSubscription | undefined;
        (async () => {
            sub = await Location.watchHeadingAsync((h) => {
                if (h.trueHeading < 0) return;
                const wanted = ((h.trueHeading - h.magHeading + 540) % 360) - 180;
                declinationRef.current += (wanted - declinationRef.current) * 0.1;
                setDeclination(declinationRef.current);
            });
        })();
        return () => sub?.remove();
    }, [hasLocationPermission]);

    function recompute() {
        const { E, N, U } = computeBasis(gravity.current, magnetic.current);
        setBasis({ E, N, U });

        const we = -E.z, wn = -N.z, wu = -U.z;
        const magAz = ((Math.atan2(we, wn) * 180) / Math.PI + 360) % 360;
        setAzimuth((magAz + declinationRef.current + 360) % 360);
        setAltitude((Math.asin(Math.min(1, Math.max(-1, wu))) * 180) / Math.PI);
    }

    useEffect(() => {
        Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);
        const sub = Accelerometer.addListener(({ x, y, z }) => {
            // The accelerometer reports gravity (pointing down); negate so it means "up".
            gravity.current = lerpVec(gravity.current, { x: -x, y: -y, z: -z }, GRAVITY_SMOOTHING);
            recompute();
        });
        return () => sub.remove();
    }, []);

    useEffect(() => {
        Magnetometer.setUpdateInterval(SENSOR_INTERVAL_MS);
        const sub = Magnetometer.addListener(({ x, y, z }) => {
            // Noisier than the accelerometer, so smoothed harder. No recompute() here - the
            // accelerometer already recomputes at the same rate.
            magnetic.current = lerpVec(magnetic.current, { x, y, z }, MAGNETIC_SMOOTHING);
        });
        return () => sub.remove();
    }, []);

    return { ...basis, declination, azimuth, altitude };
}
