import { useState } from "react";
import type { Looking } from "@/hooks/use-pair-presence";
import type { SkyBody } from "@/hooks/use-sky-bodies";
import type { DebugItem } from "@/components/debug-menu";
import { SKY_PRESETS, type SkyPreset } from "@/lib/sky-colors";

// times of day, moon phases and "look at" targets to cycle through (null = real)
const SKIES: (SkyPreset | null)[] = [null, "day", "golden", "twilight", "night"];
const PHASES = [
    null,
    { label: "new", fraction: 0.02, waxing: true },
    { label: "waxing crescent", fraction: 0.25, waxing: true },
    { label: "first quarter", fraction: 0.5, waxing: true },
    { label: "waxing gibbous", fraction: 0.8, waxing: true },
    { label: "full", fraction: 1, waxing: true },
    { label: "waning gibbous", fraction: 0.8, waxing: false },
    { label: "last quarter", fraction: 0.5, waxing: false },
    { label: "waning crescent", fraction: 0.25, waxing: false },
];
const TARGETS: Looking[] = [null, "sun", "moon"];

const next = <T>(list: T[], current: T) => list[(list.indexOf(current) + 1) % list.length];

// Development-only overrides for the sky screen: another time of day, another moon
// phase, or pretend the phone points straight at the sun/moon. Takes the real bodies and
// returns what to show, plus the items for the debug menu. In release builds (__DEV__
// false) everything is passed through unchanged.
export function useSkyDebug(realBodies: SkyBody[], realActive: SkyBody | null) {
    const [sky, setSky] = useState<SkyPreset | null>(null);
    const [phase, setPhase] = useState<(typeof PHASES)[number]>(null);
    const [target, setTarget] = useState<Looking>(null);

    // A time of day shows only the body that fits it (the moon at night/twilight, the sun
    // by day), placed where the higher of the two really is, so it's up to show off.
    const preset = __DEV__ ? sky : null;
    const higher = realBodies.length > 0 ? realBodies.reduce((a, b) => (b.altitude > a.altitude ? b : a)) : null;
    const fitting = preset && realBodies.find((b) => b.name === (SKY_PRESETS[preset] > 0 ? "sun" : "moon"));
    const shown: SkyBody | null = preset && higher && fitting
        ? { ...fitting, bearing: higher.bearing, altitude: higher.altitude, visible: higher.visible }
        : null;

    const moonPhase = __DEV__ ? phase : null;
    const bodies = (shown ? [shown] : realBodies).map((b) =>
        b.phase && moonPhase ? { ...b, phase: { fraction: moonPhase.fraction, waxing: moonPhase.waxing } } : b);

    const nextSky = next(SKIES, sky);
    const nextPhase = next(PHASES, phase);
    const nextTarget = next(TARGETS, target);
    const items: DebugItem[] = [
        ...(bodies.length > 0
            ? [{ label: nextTarget ? `Look at ${nextTarget}` : "Use sensors", onPress: () => setTarget(nextTarget) }]
            : []),
        { label: `Sky: ${sky ?? "real"} -> ${nextSky ?? "real"}`, onPress: () => setSky(nextSky) },
        { label: `Moon: ${phase?.label ?? "real"} -> ${nextPhase?.label ?? "real"}`, onPress: () => setPhase(nextPhase) },
    ];

    return {
        bodies,
        active: shown ?? realActive,
        sunAltitude: preset ? SKY_PRESETS[preset] : undefined, // replaces the real one when set
        lookAt: __DEV__ ? bodies.find((b) => b.name === target) ?? null : null,
        items,
    };
}
