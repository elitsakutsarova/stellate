export const COLORS = {
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

    glass: "rgba(255, 255, 255, 0.08)",
    glassStrong: "rgba(255, 255, 255, 0.12)",
    glassBorder: "rgba(255, 255, 255, 0.18)",
    backdrop: "rgba(5, 6, 15, 0.6)", // dims the screen behind sheets/menus
};

// With custom fonts, choose the weight by family - don't set fontWeight too.
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

// How much bigger this screen is than the design frame (~1 on phones).
export const FRAME = { width: 393, height: 852 };
export const fitScale = (width: number, height: number) => Math.min(width / FRAME.width, height / FRAME.height);
