import { useEffect, useRef, useState } from "react";
import { Accelerometer, Magnetometer } from "expo-sensors";
import * as Location from "expo-location";

export type Vec3 = { x: number; y: number; z: number };

function normalize(v: Vec3): Vec3 {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}
function cross(a: Vec3, b: Vec3): Vec3 {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

// Device-local axes, as reported by the raw Accelerometer/Magnetometer on
// both platforms: x = screen right, y = towards the top edge, z = out of
// the screen towards your face.
//
// This deliberately avoids expo-sensors' DeviceMotion.rotation — despite
// being named alpha/beta/gamma like the W3C device-orientation spec, on iOS
// it's actually CMAttitude.yaw/pitch/roll passed straight through in
// radians (the docs' "expressed in degrees" is wrong), and on Android it's
// SensorManager.getOrientation() with two of the three axes negated. Both
// are real Euler angles, just in different rotation conventions than the
// W3C one and from each other, so building a rotation matrix out of them
// with one shared formula silently gives the wrong attitude at any real
// tilt — which is why the sky view could never actually lock onto the sun.
//
// Raw gravity + raw magnetic field don't have that problem: they're just
// vectors in the device's own axes, consistent on both platforms. E/N/U
// below is the standard tilt-compensated-compass construction (the same
// one Android's SensorManager.getRotationMatrix uses internally) and holds
// at any tilt, including pointing straight up.
function computeBasis(gravity: Vec3, magnetic: Vec3) {
    const U = normalize(gravity);
    const E = normalize(cross(magnetic, gravity));
    const N = normalize(cross(gravity, E));
    return { E, N, U };
}

// E, N, U are device-local unit vectors pointing at *magnetic* east, north
// and up — i.e. "if you wanted to point the phone at magnetic north right
// now, here's what that looks like in the phone's own x/y/z axes." declination
// (magnetic → true north correction, from Location's heading, which already
// knows it for your location) lets callers work in true bearings, matching
// SunCalc.
export function useDeviceOrientation() {
    const [basis, setBasis] = useState(() => computeBasis({ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: -1 }));
    const [azimuth, setAzimuth] = useState(0);
    const [altitude, setAltitude] = useState(0);
    const [declination, setDeclination] = useState(0);

    const gravity = useRef<Vec3>({ x: 0, y: 0, z: 1 });
    const magnetic = useRef<Vec3>({ x: 0, y: 1, z: -1 });
    const declinationRef = useRef(0);

    useEffect(() => {
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
    }, []);

    function recompute() {
        const { E, N, U } = computeBasis(gravity.current, magnetic.current);
        setBasis({ E, N, U });

        // device forward (looking through the back of the phone) is local
        // (0,0,-1); its components along E/N/U give its world direction.
        const we = -E.z, wn = -N.z, wu = -U.z;
        const magAz = ((Math.atan2(we, wn) * 180) / Math.PI + 360) % 360;
        setAzimuth((magAz + declinationRef.current + 360) % 360);
        setAltitude((Math.asin(Math.min(1, Math.max(-1, wu))) * 180) / Math.PI);
    }

    useEffect(() => {
        Accelerometer.setUpdateInterval(100);
        const sub = Accelerometer.addListener(({ x, y, z }) => {
            // Accelerometer reports the gravity vector itself (pointing down —
            // e.g. z = -1g lying flat screen-up per Apple's CMAccelerometerData
            // docs), not the reaction force pointing up. Negate so `gravity`
            // consistently means "up" for computeBasis.
            gravity.current = lerpVec(gravity.current, { x: -x, y: -y, z: -z }, 0.3);
            recompute();
        });
        return () => sub.remove();
    }, []);

    useEffect(() => {
        Magnetometer.setUpdateInterval(100);
        const sub = Magnetometer.addListener(({ x, y, z }) => {
            magnetic.current = lerpVec(magnetic.current, { x, y, z }, 0.3);
            recompute();
        });
        return () => sub.remove();
    }, []);

    return { ...basis, declination, azimuth, altitude };
}
