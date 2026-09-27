import { useEffect, useRef, type ReactNode } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { COLORS, FONTS, RADIUS } from "@/lib/theme";
import { playTap } from "@/lib/sounds";

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

export const MAX_TEXT_WIDTH = 440;

// No orphans at end of text (i.e. glue the last two words, and ask each platform for balanced line breaks.
const noOrphan = (text: string) => text.replace(/ (\S+)$/, "\u00A0$1");
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

export function Button({ label, onPress, variant = "primary", busy, disabled, style, accent = COLORS.accent }: {
    label: string;
    onPress: () => void;
    variant?: "primary" | "glass" | "danger" | "ghost";
    accent?: string;         // primary button colour (default lavender)
    busy?: boolean;          // shows a spinner instead of the label
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
}) {
    const look = {
        primary: { background: accent, border: 0, text: COLORS.onAccent, height: 54, size: 17 },
        glass: { background: COLORS.glass, border: 1, text: COLORS.text, height: 54, size: 17 },
        danger: { background: COLORS.glass, border: 1, text: COLORS.danger, height: 54, size: 17 },
        ghost: { background: "transparent", border: 0, text: COLORS.muted, height: 44, size: 15 },
    }[variant];
    return (
        <Pressable
            onPress={() => {
                playTap();
                onPress();
            }}
            disabled={disabled || busy}
            style={({ pressed }) => [
                {
                    minHeight: look.height, paddingHorizontal: 24, borderRadius: RADIUS,
                    alignItems: "center", justifyContent: "center",
                    backgroundColor: look.background,
                    borderWidth: look.border, borderColor: COLORS.glassBorder,
                    opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
                },
                style,
            ]}
        >
            {busy ? (
                <ActivityIndicator color={look.text} />
            ) : (
                <Text style={{ fontFamily: FONTS.medium, fontSize: look.size, color: look.text }}>{label}</Text>
            )}
        </Pressable>
    );
}

export const glass = {
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    borderRadius: RADIUS,
} satisfies ViewStyle;

export function Pill({ children }: { children: ReactNode }) {
    return (
        <Text
            style={[glass, {
                borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, overflow: "hidden",
                fontFamily: FONTS.regular, fontSize: 13, color: COLORS.muted,
            }]}
        >
            {children}
        </Text>
    );
}

export function WaitingLine({ children }: { children: ReactNode }) {
    const pulse = useRef(new Animated.Value(0.3)).current;
    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
                Animated.timing(pulse, { toValue: 0.3, duration: 900, useNativeDriver: true }),
            ])
        );
        loop.start();
        return () => loop.stop();
    }, [pulse]);

    return (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accent, opacity: pulse }} />
            <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: COLORS.muted }}>{children}</Text>
        </View>
    );
}
