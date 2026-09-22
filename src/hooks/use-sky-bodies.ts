import { useEffect, useState } from "react";
/* import SunCalc from "suncalc"; */

const SunCalc = require("suncalc");
type Body = { altitude: number; bearing: number; visible: boolean };

// where the sun and moon actually are, recalculated every 30s - even though they move slowly, this is to keep the display accurate and in sync with the real world
// bearing is a compass heading: 0=north, 90=east, 180=south, 270=west

// SunCalc's azimuth is 0=south, increasing westward — convert to a normal
// compass bearing where 0=north, clockwise, which is what a heading uses.
function toBearing(azimuthRadians: number) {
    const deg = (azimuthRadians * 180) / Math.PI;
    return (deg + 180 + 360) % 360;
}

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
                altitude: (sunPos.altitude * 180) / Math.PI,
                bearing: toBearing(sunPos.azimuth),
                visible: sunPos.altitude > 0,
            });
            setMoon({
                altitude: (moonPos.altitude * 180) / Math.PI,
                bearing: toBearing(moonPos.azimuth),
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