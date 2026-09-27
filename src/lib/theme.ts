// One place for the app's look, so every screen matches. The night palette
// is the same one the sky screen already uses; lavender (from the Figma
// frames) is the accent.
export const COLORS = {
    // backgrounds, top -> bottom
    night: "#0A0F2C",
    nightMid: "#1B1F4B",
    nightLow: "#3A2E5C",
    glow: "#E9C6FF",      // soft light behind the sun/moon art

    text: "#EEF0FF",
    muted: "#8C93B8",
    link: "#AFC3FF",
    danger: "#F7A1A1",
    online: "#9FE3D0",
    together: "#F7B7C8",

    accent: "#E9C6FF",    // primary buttons
    onAccent: "#1B1F4B",  // text on primary buttons

    // "glass": see-through white with a thin light edge
    glass: "rgba(255, 255, 255, 0.08)",
    glassStrong: "rgba(255, 255, 255, 0.12)",
    glassBorder: "rgba(255, 255, 255, 0.18)",
    backdrop: "rgba(5, 6, 15, 0.6)", // dims the screen behind sheets/menus
};

// Font family names, as loaded in app/_layout.tsx. (With custom fonts, pick
// the weight by family - don't also set fontWeight, Android ignores it or
// falls back to the system font.)
export const FONTS = {
    display: "BelgantAesthetic",      // big headlines
    regular: "PublicSans-Regular",
    medium: "PublicSans-Medium",      // buttons
    light: "PublicSans-Light",        // small print
    boldItalic: "PublicSans-BoldItalic",
};

export const FONT_FILES = {
    [FONTS.display]: require("@/assets/fonts/BelgantAesthetic.otf"),
    [FONTS.regular]: require("@/assets/fonts/PublicSans-Regular.ttf"),
    [FONTS.medium]: require("@/assets/fonts/PublicSans-Medium.ttf"),
    [FONTS.light]: require("@/assets/fonts/PublicSans-Light.ttf"),
    [FONTS.boldItalic]: require("@/assets/fonts/PublicSans-BoldItalic.ttf"),
};

export const RADIUS = 16;

// The design frames' size. fitScale: how much bigger this screen is than a
// frame, limited by whichever side has less room - so things grow on a
// tablet but never spill off a wide-but-short screen. (~1 on phones.)
export const FRAME = { width: 393, height: 852 };
export const fitScale = (width: number, height: number) => Math.min(width / FRAME.width, height / FRAME.height);
