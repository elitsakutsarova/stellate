import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { COLORS, FONTS, RADIUS } from "@/lib/theme";

// Full-screen night sky: the same gradient as the sky screen, with a soft
// lavender glow (like the light behind the sun/moon in the designs).
// glowY: where the glow sits, as a fraction of the screen height.
export function NightBackground({ glowY = 0.35 }: { glowY?: number }) {
    return (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
                <LinearGradient id="night" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={COLORS.night} />
                    <Stop offset="0.6" stopColor={COLORS.nightMid} />
                    <Stop offset="1" stopColor={COLORS.nightLow} />
                </LinearGradient>
                <RadialGradient id="glow" cx="50%" cy={`${glowY * 100}%`} rx="70%" ry="35%">
                    <Stop offset="0" stopColor={COLORS.glow} stopOpacity="0.28" />
                    <Stop offset="1" stopColor={COLORS.glow} stopOpacity="0" />
                </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#night)" />
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#glow)" />
        </Svg>
    );
}

// Longest a line of text may get (px) - like max-width in CSS, so on a
// tablet a sentence stays a readable block instead of one endless line.
export const MAX_TEXT_WIDTH = 440;

// No orphans (a single word alone on the last line):
// - glues the last two words together with a non-breaking space, and
// - asks each platform for balanced line breaks (Android: "balanced",
//   iOS: "push-out", which avoids orphans), like text-wrap: pretty in CSS.
export const noOrphan = (text: string) => text.replace(/ (\S+)$/, "\u00A0$1");
const tidy = (children: ReactNode) => (typeof children === "string" ? noOrphan(children) : children);
const pretty = { textBreakStrategy: "balanced", lineBreakStrategyIOS: "push-out" } as const;

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
    return (
        <Text {...pretty} style={[{ fontFamily: FONTS.display, fontSize: 44, lineHeight: 52, color: COLORS.text }, style]}>
            {tidy(children)}
        </Text>
    );
}

export function Body({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
    return (
        <Text {...pretty} style={[{ fontFamily: FONTS.regular, fontSize: 16, lineHeight: 24, color: COLORS.text }, style]}>
            {tidy(children)}
        </Text>
    );
}

// "primary": solid lavender - the one main action on a screen.
// "glass": see-through - everything else.
export function Button({ label, onPress, variant = "primary", busy, disabled, style }: {
    label: string;
    onPress: () => void;
    variant?: "primary" | "glass";
    busy?: boolean;          // shows a spinner instead of the label
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
}) {
    const primary = variant === "primary";
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled || busy}
            style={({ pressed }) => [
                {
                    minHeight: 54, paddingHorizontal: 24, borderRadius: RADIUS,
                    alignItems: "center", justifyContent: "center",
                    backgroundColor: primary ? COLORS.accent : COLORS.glass,
                    borderWidth: primary ? 0 : 1, borderColor: COLORS.glassBorder,
                    opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
                },
                style,
            ]}
        >
            {busy ? (
                <ActivityIndicator color={primary ? COLORS.onAccent : COLORS.text} />
            ) : (
                <Text style={{ fontFamily: FONTS.medium, fontSize: 17, color: primary ? COLORS.onAccent : COLORS.text }}>{label}</Text>
            )}
        </Pressable>
    );
}

// The frosted look for panels, inputs and cards.
// (`satisfies`, not a type annotation, so it also fits text inputs.)
export const glass = {
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    borderRadius: RADIUS,
} satisfies ViewStyle;
