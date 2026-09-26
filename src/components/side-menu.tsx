import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";

const SLIDE_MS = 250;
const MENU_WIDTH = 0.8; // fraction of the screen width
const COLORS = { panel: "#141836", backdrop: "#000000", icon: "#EEF0FF" };

// ☰ icon geometry: three 2px lines, GAP apart
const LINE_W = 22;
const GAP = 7;

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
};

// A panel that slides in from the left over a dimmed backdrop, plus the ☰
// button that opens it. The button stays in the top-left corner, above the
// panel, and turns into an X as the panel comes out (and back as it closes)
// — both driven by the same `progress`, so they always move in step.
// Always rendered (just moved off screen when closed) so it can animate both
// ways; animations run on the native side.
export function SideMenu({ open, onOpenChange, children }: Props) {
    const { width } = useSafeAreaFrame();
    const insets = useSafeAreaInsets();
    const menuWidth = width * MENU_WIDTH;
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
                    style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.backdrop, opacity: Animated.multiply(progress, 0.5) }]}
                >
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => onOpenChange(false)} accessibilityLabel="Close menu" />
                </Animated.View>
                <Animated.View
                    style={{
                        position: "absolute", top: 0, bottom: 0, left: 0, width: menuWidth,
                        backgroundColor: COLORS.panel,
                        paddingTop: insets.top + 64, paddingHorizontal: 24, gap: 24,
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
                style={{ position: "absolute", top: insets.top + 12, left: 16, width: LINE_W, height: GAP * 2 + 2 }}
            >
                {lines.map(({ top, style }, i) => (
                    <Animated.View
                        key={i}
                        style={[
                            { position: "absolute", top, left: 0, width: LINE_W, height: 2, borderRadius: 1, backgroundColor: COLORS.icon },
                            style,
                        ]}
                    />
                ))}
            </Pressable>
        </View>
    );
}
