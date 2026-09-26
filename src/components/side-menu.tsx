import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";

const SLIDE_MS = 250;
const MENU_WIDTH = 0.8; // fraction of the screen width
const COLORS = { panel: "#141836", backdrop: "#000000", icon: "#EEF0FF" };

export function MenuButton({ onPress }: { onPress: () => void }) {
    const insets = useSafeAreaInsets();
    return (
        <Pressable
            onPress={onPress}
            hitSlop={12}
            accessibilityLabel="Open menu"
            style={{ position: "absolute", top: insets.top + 12, left: 16, zIndex: 3, gap: 5, padding: 4 }}
        >
            {[0, 1, 2].map((i) => (
                <View key={i} style={{ width: 22, height: 2, borderRadius: 1, backgroundColor: COLORS.icon }} />
            ))}
        </Pressable>
    );
}

// A panel that slides in from the left over a dimmed backdrop; tapping the
// backdrop closes it. Always rendered (just moved off screen when closed) so
// it can animate both ways; the animation runs on the native side.
export function SideMenu({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
    const { width } = useSafeAreaFrame();
    const insets = useSafeAreaInsets();
    const menuWidth = width * MENU_WIDTH;
    const progress = useRef(new Animated.Value(0)).current; // 0 closed, 1 open

    useEffect(() => {
        Animated.timing(progress, { toValue: open ? 1 : 0, duration: SLIDE_MS, useNativeDriver: true }).start();
    }, [open, progress]);

    return (
        <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]} pointerEvents={open ? "auto" : "none"}>
            <Animated.View
                style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.backdrop, opacity: Animated.multiply(progress, 0.5) }]}
            >
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
            </Animated.View>
            <Animated.View
                style={{
                    position: "absolute", top: 0, bottom: 0, left: 0, width: menuWidth,
                    backgroundColor: COLORS.panel,
                    paddingTop: insets.top + 64, paddingHorizontal: 24, gap: 24,
                    transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-menuWidth, 0] }) }],
                }}
            >
                {children}
            </Animated.View>
        </View>
    );
}
