// The sky's colours through the day, following the real sun's altitude.
// A few keyframes (below); anything in between is blended smoothly, so the
// sky never jumps from one look to the next.

type Rgba = [number, number, number, number];

type Keyframe = {
    sun: number;        // sun altitude in degrees
    zenith: string;     // sky high up
    horizon: string;    // sky at the horizon
    ground: string;     // ground just below the horizon
    labels: string;     // compass letters + horizon line (readable on the horizon colour)
    north: string;      // the "N", in its own accent colour
    card: Rgba;         // status card / pill background: white glass at night, smoked glass by day
    daylight: number;   // 0 = night look for panels (original colours), 1 = day look (blue)
};

const KEYFRAMES: Keyframe[] = [
    { sun: -18, zenith: "#0A0F2C", horizon: "#3A2E5C", ground: "#1C1A3F", labels: "#C8CEF5", north: "#F7B7C8", card: [255, 255, 255, 0.05], daylight: 0 }, // night
    { sun: -12, zenith: "#0A0F2C", horizon: "#2B2A5A", ground: "#1C1A3F", labels: "#C8CEF5", north: "#F7B7C8", card: [255, 255, 255, 0.05], daylight: 0 }, // night
    { sun: -5, zenith: "#1C2A5E", horizon: "#8A6A9E", ground: "#1E1B3A", labels: "#C8CEF5", north: "#F7B7C8", card: [255, 255, 255, 0.06], daylight: 0 },  // twilight
    { sun: 2, zenith: "#1F3A6E", horizon: "#F4B183", ground: "#2A2440", labels: "#1D3A6E", north: "#9E3A5E", card: [12, 18, 44, 0.3], daylight: 1 },         // golden hour
    { sun: 15, zenith: "#031851", horizon: "#74baeb", ground: "#1F2D4A", labels: "#1D4E9E", north: "#A8325E", card: [8, 20, 48, 0.32], daylight: 1 },       // day
];

// Named sun altitudes, for the debug button to jump between.
export const SKY_PRESETS = { day: 40, golden: 2, twilight: -5, night: -20 } as const;
export type SkyPreset = keyof typeof SKY_PRESETS;

const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixRgb = (x: number[], y: number[], t: number) => x.map((v, i) => mix(v, y[i], t));
const css = (rgb: number[]) => `rgb(${rgb.map(Math.round).join(", ")})`;
// Panels (side menu, sheets): at night the upper sky a little deeper (the
// original look); by day pulled towards this deep blue, so they don't turn
// purple against the blue sky.
const DEEP = hexToRgb("#05060F");
const PANEL_BLUE = hexToRgb("#1B1F4B");
// The side menu's accents: lavender + purple-grey at night (the original
// theme), sky blue + blue-grey by day.
const NIGHT_ACCENT = hexToRgb("#E9C6FF"), DAY_ACCENT = hexToRgb("#9FD0F2");
const NIGHT_MUTED = hexToRgb("#8C93B8"), DAY_MUTED = hexToRgb("#9DB2D6");

// How the sky gradient is shaped, from the horizon (0) up to 60 degrees (1):
// how much of the zenith colour there is at each point. Fast near the
// horizon, then slower and slower - so the light colour hugs the horizon but
// fades out with no visible edge. (An exponential ease, normalised so it's
// exactly 0 at the horizon and 1 at the top. With 0.25 it's ~70% deep blue
// at 30% of the way up.)
const SHARPNESS = 0.25; // smaller = thinner light band
const ease = (o: number) => (1 - Math.exp(-o / SHARPNESS)) / (1 - Math.exp(-1 / SHARPNESS));
const STOP_OFFSETS = [0, 0.03, 0.07, 0.12, 0.18, 0.25, 0.35, 0.5, 0.7, 1];

export function skyColors(sunAltitude: number) {
    // the two keyframes around this altitude (clamped at both ends)
    const next = KEYFRAMES.findIndex((k) => k.sun >= sunAltitude);
    const b = KEYFRAMES[next === -1 ? KEYFRAMES.length - 1 : next];
    const a = KEYFRAMES[Math.max(0, (next === -1 ? KEYFRAMES.length : next) - 1)];
    const t = a === b ? 0 : (sunAltitude - a.sun) / (b.sun - a.sun);
    const blend = (key: "zenith" | "horizon" | "ground" | "labels" | "north") => mixRgb(hexToRgb(a[key]), hexToRgb(b[key]), t);

    const zenith = blend("zenith");
    const horizon = blend("horizon");
    const card = mixRgb(a.card, b.card, t);
    const day = mix(a.daylight, b.daylight, t); // blends, so panels change smoothly too
    return {
        zenith: css(zenith),
        horizon: css(horizon),
        // the sky gradient's colour stops (see ease above)
        stops: STOP_OFFSETS.map((offset) => ({ offset, color: css(mixRgb(horizon, zenith, ease(offset))) })),
        ground: css(blend("ground")),
        labels: css(blend("labels")),
        north: css(blend("north")),
        card: `rgba(${card.slice(0, 3).map(Math.round).join(", ")}, ${card[3].toFixed(3)})`,
        // panels (side menu, sheets) - see DEEP / PANEL_BLUE above
        surface: css(mixRgb(mixRgb(zenith, DEEP, 0.3), mixRgb(zenith, PANEL_BLUE, 0.55), day)),
        menuAccent: css(mixRgb(NIGHT_ACCENT, DAY_ACCENT, day)),
        menuMuted: css(mixRgb(NIGHT_MUTED, DAY_MUTED, day)),
    };
}
