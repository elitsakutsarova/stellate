import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, BackHandler, PanResponder, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS } from "@/lib/theme";
import { MAX_TEXT_WIDTH } from "@/components/ui";

const SLIDE_MS = 280;
const DISMISS_PX = 100;     // drag down further than this to close...
const DISMISS_SPEED = 1;    // ...or flick down faster than this

// A panel that slides up from the bottom over a dimmed screen. Closes by
// swiping it down, tapping the dimmed part, or Android's back button.
// Always rendered (just pushed below the screen when closed) so it can
// animate both ways.
export function BottomSheet({ open, onClose, children, background = COLORS.nightMid }: {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
    background?: string; // panel colour (defaults to the night theme)
}) {
    const { height } = useSafeAreaFrame();
    const insets = useSafeAreaInsets();
    const progress = useRef(new Animated.Value(0)).current; // 0 closed, 1 open
    const drag = useRef(new Animated.Value(0)).current;     // how far it's being pulled down (px)
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // JS-driven (not the native driver): the drag below has to be added to
    // this, and the two must run on the same side
    useEffect(() => {
        if (open) drag.setValue(0);
        Animated.timing(progress, { toValue: open ? 1 : 0, duration: SLIDE_MS, useNativeDriver: false }).start();
    }, [open, progress, drag]);

    // Android back = close the sheet (instead of leaving the screen)
    useEffect(() => {
        if (!open) return;
        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            onCloseRef.current();
            return true;
        });
        return () => sub.remove();
    }, [open]);

    // Swipe down to dismiss. Only takes over once the finger clearly moves
    // down, so taps on the buttons inside still work.
    const swipe = useMemo(() => PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
            if (g.dy > DISMISS_PX || g.vy > DISMISS_SPEED) onCloseRef.current();
            else Animated.spring(drag, { toValue: 0, useNativeDriver: false }).start();
        },
        onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: false }).start(),
    }), [drag]);

    const slide = progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] });

    return (
        <View style={[StyleSheet.absoluteFill, { zIndex: 20 }]} pointerEvents={open ? "auto" : "none"}>
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.backdrop, opacity: progress }]}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
            </Animated.View>
            <Animated.View
                {...swipe.panHandlers}
                style={{
                    position: "absolute", left: 0, right: 0, bottom: 0,
                    backgroundColor: background,
                    borderTopLeftRadius: 28, borderTopRightRadius: 28,
                    borderWidth: 1, borderBottomWidth: 0, borderColor: COLORS.glassBorder,
                    paddingHorizontal: 24, paddingTop: 12, paddingBottom: insets.bottom + 24,
                    gap: 20, alignItems: "center",
                    transform: [{ translateY: Animated.add(slide, drag) }],
                }}
            >
                {/* grab handle - shows it can be pulled down */}
                <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.glassBorder }} />
                {/* same capped-width column as the screens' content, so on a
                    tablet the sheet's contents don't stretch across it all */}
                <View style={{ width: "100%", maxWidth: MAX_TEXT_WIDTH, gap: 20 }}>{children}</View>
            </Animated.View>
        </View>
    );
}
