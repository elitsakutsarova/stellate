import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, FONTS } from "@/lib/theme";

const SLIDE_MS = 250;
const MENU_WIDTH = 0.8;      // fraction of the screen width...
const MENU_MAX_WIDTH = 360;  // ...but never wider than this (tablets)


// ☰ icon geometry: three 2px lines, GAP apart, BUTTON_TOP below the safe area
const LINE_W = 22;
const GAP = 7;
const BUTTON_TOP = 12;
// the ☰ button's vertical middle (below the safe area top) - so things next
// to it, like the viewfinder's hint, can line up with it
export const MENU_BUTTON_CENTER = BUTTON_TOP + (GAP * 2 + 2) / 2;

// A section title inside the menu, e.g. "Notifications".
export function MenuHeading({ children }: { children: ReactNode }) {
    return (
        <Text style={{ fontFamily: FONTS.medium, color: COLORS.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5 }}>
            {children}
        </Text>
    );
}

// One on/off row. The whole row is the button; the switch only *shows* the
// state (no touches of its own), so it can't flip on and back off while
// something (like a permission popup) is still being decided - it only
// moves once the answer is known.
export function MenuToggle({ label, value, onChange, disabled }: {
    label: string;
    value: boolean;
    onChange: (on: boolean) => void;
    disabled?: boolean;
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
                    trackColor={{ false: COLORS.glassStrong, true: COLORS.accent }}
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
};

// Menu contents go in as two children: the first sits at the top, the last
// is pushed to the bottom (like justify-content: space-between).
// A panel that slides in from the left over a dimmed backdrop, plus the ☰
// button that opens it. The button stays in the top-left corner, above the
// panel, and turns into an X as the panel comes out (and back as it closes)
// - both driven by the same `progress`, so they always move in step.
// Always rendered (just moved off screen when closed) so it can animate both
// ways; animations run on the native side.
export function SideMenu({ open, onOpenChange, children }: Props) {
    const { width } = useSafeAreaFrame();
    const insets = useSafeAreaInsets();
    const menuWidth = Math.min(width * MENU_WIDTH, MENU_MAX_WIDTH);
    const progress = useRef(new Animated.Value(0)).current; // 0 closed, 1 open

    useEffect(() => {
        Animated.timing(progress, { toValue: open ? 1 : 0, duration: SLIDE_MS, useNativeDriver: true }).start();
    }, [open, progress]);

    const between = (closed: number | string, opened: number | string) =>
        progress.interpolate({ inputRange: [0, 1], outputRange: [closed, opened] as number[] | string[] });

    // ☰ -> X: the outer lines slide to the middle and tilt ±45°, the middle one fades
    const lines = [
        { top: 0, style: { transform: [{ translateY: between(0, GAP) }, { rotate: between("0deg", "45deg") }] } },
        { top: GAP, style: { opacity: between(1, 0) } },
        { top: GAP * 2, style: { transform: [{ translateY: between(0, -GAP) }, { rotate: between("0deg", "-45deg") }] } },
    ];

    return (
        <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]} pointerEvents="box-none">
            {/* backdrop + panel only catch touches while open */}
            <View style={StyleSheet.absoluteFill} pointerEvents={open ? "auto" : "none"}>
                <Animated.View
                    style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.backdrop, opacity: progress }]}
                >
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => onOpenChange(false)} accessibilityLabel="Close menu" />
                </Animated.View>
                <Animated.View
                    style={{
                        position: "absolute", top: 0, bottom: 0, left: 0, width: menuWidth,
                        backgroundColor: COLORS.nightMid,
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
                style={{ position: "absolute", top: insets.top + BUTTON_TOP, left: 16, width: LINE_W, height: GAP * 2 + 2 }}
            >
                {lines.map(({ top, style }, i) => (
                    <Animated.View
                        key={i}
                        style={[
                            { position: "absolute", top, left: 0, width: LINE_W, height: 2, borderRadius: 1, backgroundColor: COLORS.text },
                            style,
                        ]}
                    />
                ))}
            </Pressable>
        </View>
    );
}
