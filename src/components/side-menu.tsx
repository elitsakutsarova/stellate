import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, FONTS, fitScale } from "@/lib/theme";

const SLIDE_MS = 250;
const MENU_WIDTH = 0.8;      // fraction of the screen width...
const MENU_MAX_WIDTH = 360;  // ...but never wider than this (tablets)


// ☰ size on a phone; grows on bigger screens
export function menuIcon(width: number, height: number) {
    const s = Math.max(1, fitScale(width, height));
    const line = 22 * s, thick = 2 * s, gap = 7 * s, top = 12 * s;
    return {
        line, thick, gap, top,
        height: gap * 2 + thick,
        // vertical middle, so the viewfinder's hint can line up with it
        center: top + gap + thick / 2,
    };
}

export function MenuHeading({ children, color = COLORS.muted }: { children: ReactNode; color?: string }) {
    return (
        <Text style={{ fontFamily: FONTS.medium, color, fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5 }}>
            {children}
        </Text>
    );
}

// The whole row is the button; the switch only shows the state, so it can't
// flip on and back while a permission popup is still open.
export function MenuToggle({ label, value, onChange, disabled, accent = COLORS.accent }: {
    label: string;
    value: boolean;
    onChange: (on: boolean) => void;
    disabled?: boolean;
    accent?: string; // the switch's "on" colour
}) {
    return (
        <Pressable
            onPress={() => onChange(!value)}
            disabled={disabled}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}
        >
            <Text style={{ fontFamily: FONTS.regular, color: COLORS.text, fontSize: 16, lineHeight: 22, flex: 1 }}>{label}</Text>
            <View pointerEvents="none">
                <Switch
                    value={value}
                    disabled={disabled}
                    trackColor={{ false: COLORS.glassStrong, true: accent }}
                    thumbColor={COLORS.text}
                    ios_backgroundColor={COLORS.glassStrong}
                />
            </View>
        </Pressable>
    );
}

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
    background?: string; // panel colour (defaults to the night theme)
};

// A panel sliding in from the left, and the ☰ button that turns into an X with it.
// Children: the first sits at the top, the last at the bottom.
export function SideMenu({ open, onOpenChange, children, background = COLORS.nightMid }: Props) {
    const { width, height } = useSafeAreaFrame();
    const icon = menuIcon(width, height);
    const insets = useSafeAreaInsets();
    const menuWidth = Math.min(width * MENU_WIDTH, MENU_MAX_WIDTH);
    const progress = useRef(new Animated.Value(0)).current; // 0 closed, 1 open

    useEffect(() => {
        Animated.timing(progress, { toValue: open ? 1 : 0, duration: SLIDE_MS, useNativeDriver: true }).start();
    }, [open, progress]);

    const between = (closed: number | string, opened: number | string) =>
        progress.interpolate({ inputRange: [0, 1], outputRange: [closed, opened] as number[] | string[] });

    const lines = [
        { top: 0, style: { transform: [{ translateY: between(0, icon.gap) }, { rotate: between("0deg", "45deg") }] } },
        { top: icon.gap, style: { opacity: between(1, 0) } },
        { top: icon.gap * 2, style: { transform: [{ translateY: between(0, -icon.gap) }, { rotate: between("0deg", "-45deg") }] } },
    ];

    return (
        <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]} pointerEvents="box-none">
            <View style={StyleSheet.absoluteFill} pointerEvents={open ? "auto" : "none"}>
                <Animated.View
                    style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.backdrop, opacity: progress }]}
                >
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => onOpenChange(false)} accessibilityLabel="Close menu" />
                </Animated.View>
                <Animated.View
                    style={{
                        position: "absolute", top: 0, bottom: 0, left: 0, width: menuWidth,
                        backgroundColor: background,
                        borderRightWidth: 1, borderColor: COLORS.glassBorder,
                        paddingTop: insets.top + 72, paddingBottom: insets.bottom + 24, paddingHorizontal: 24,
                        justifyContent: "space-between",
                        transform: [{ translateX: between(-menuWidth, 0) }],
                    }}
                >
                    {children}
                </Animated.View>
            </View>

            <Pressable
                onPress={() => onOpenChange(!open)}
                hitSlop={12}
                accessibilityLabel={open ? "Close menu" : "Open menu"}
                style={{ position: "absolute", top: insets.top + icon.top, left: 16 * (icon.line / 22), width: icon.line, height: icon.height }}
            >
                {lines.map(({ top, style }, i) => (
                    <Animated.View
                        key={i}
                        style={[
                            { position: "absolute", top, left: 0, width: icon.line, height: icon.thick, borderRadius: icon.thick / 2, backgroundColor: COLORS.text },
                            style,
                        ]}
                    />
                ))}
            </Pressable>
        </View>
    );
}
