import { useEffect, useRef, useState } from "react";
import { Magnetometer } from "expo-sensors";

// for the compass heading, which is used to rotate the sky view so that it matches the real world
// ~expo-sensors requirement: reading raw magnetometer values and converting them into a heading

export function useCompassHeading() {
    const [heading, setHeading] = useState(0);
    const smoothed = useRef(0);

    useEffect(() => {
        Magnetometer.setUpdateInterval(150);
        const sub = Magnetometer.addListener(({ x, y }) => {
            let angle = Math.atan2(y, x) * (180 / Math.PI);
            angle = (angle - 90 + 360) % 360; // rough calibration for phone held flat, screen up

            // smoothing so the needle doesn't jitter with every reading
            const diff = ((angle - smoothed.current + 540) % 360) - 180;
            smoothed.current = (smoothed.current + diff * 0.15 + 360) % 360;
            setHeading(smoothed.current);
        });
        return () => sub.remove();
    }, []);

    return heading;
}