import { useEffect, useRef } from "react";
import { View, Text } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import { projectToScreen, type SkyBody } from "@/hooks/use-sky-bodies";
import type { Vec3 } from "@/hooks/use-device-orientation";
import type { Looking } from "@/hooks/use-pair-presence";

// How far in from each screen edge the body's centre must be before it counts
// as "looking" (fraction of width/height) — so the tap, flash and together
// moment wait until it's properly in view, not when a sliver shows at the edge.
const LOOK_MARGIN = 0.2;

type Props = {
    bodies: SkyBody[];       // both: you can look at either one
    active: SkyBody | null;  // the one the arrow guides you to
    E: Vec3;
    N: Vec3;
    U: Vec3;
    declination: number;
    onLookingChange: (looking: Looking) => void;
};

// Guidance on top of the drawn sky (SkyScene draws the sun/moon itself): an
// arrow at the screen edge pointing to the main body while you're looking at
// nothing, smoothed every frame, and a haptic tap the moment the sun or moon
// (glow or below-horizon ring) comes on screen.
// Self-contained — sky.tsx
// only needs to know where the target is (active) and which way the
// device is pointing (E/N/U/declination), not how any of this works.
export function SkyViewfinder({ bodies, active, E, N, U, declination, onLookingChange }: Props) {
    const { width, height } = useSafeAreaFrame();
    const insets = useSafeAreaInsets();
    const projection = active
        ? projectToScreen(E, N, U, declination, active.bearing, active.altitude, width, height)
        : null;

    // what's on screen right now — "sun", "moon", or null if nothing is. If
    // both are (e.g. a daytime moon near the sun), the one nearer the centre.
    const onScreen = bodies
        .map((body) => ({ name: body.name, p: projectToScreen(E, N, U, declination, body.bearing, body.altitude, width, height) }))
        .filter(({ p }) =>
            p.visible &&
            p.x > width * LOOK_MARGIN && p.x < width * (1 - LOOK_MARGIN) &&
            p.y > height * LOOK_MARGIN && p.y < height * (1 - LOOK_MARGIN))
        .sort((a, b) => a.p.angleFromCenter - b.p.angleFromCenter);
    const lookingAt: Looking = onScreen[0]?.name ?? null;
    const arrowRef = useRef<View | null>(null);
    // Kept in sync every render (not via an effect) so the animation loop
    // below can always read the latest projection without needing to
    // restart — projection is a new object every render, so depending on
    // it directly would tear down and reset the loop on every sensor tick.
    const projectionRef = useRef(projection);
    projectionRef.current = projection;
    const arrowState = useRef({
        x: projection?.arrowX ?? 0,
        y: projection?.arrowY ?? 0,
        deg: projection?.arrowDeg ?? 0,
    });

    useEffect(() => {
        let animationFrame: number;
        function loop() {
            animationFrame = requestAnimationFrame(loop);
            const p = projectionRef.current;
            if (p) {
                arrowState.current.x += (p.arrowX - arrowState.current.x) * 0.1;
                arrowState.current.y += (p.arrowY - arrowState.current.y) * 0.1;
                // shortest-path angle smoothing, so crossing the 0°/360°
                // wrap doesn't make the arrow spin the long way around
                const deltaDeg = ((p.arrowDeg - arrowState.current.deg + 540) % 360) - 180;
                arrowState.current.deg += deltaDeg * 0.1;
            }
            arrowRef.current?.setNativeProps({
                style: {
                    left: arrowState.current.x - 16,
                    top: arrowState.current.y - 16,
                    transform: [{ rotate: `${arrowState.current.deg}deg` }],
                },
            });
        }
        loop();
        return () => cancelAnimationFrame(animationFrame);
    }, []);

    // Runs only when lookingAt actually changes: tap as the sun/moon comes
    // on screen (not while it stays there), and tell sky.tsx either way.
    useEffect(() => {
        if (lookingAt) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLookingChange(lookingAt);
    }, [lookingAt, onLookingChange]);

    if (!active || !projection || lookingAt) return null;

    return (
        // Spans the full screen explicitly — a parent using alignItems:
        // "center" would otherwise shrink a flex:1 child to its content
        // width, throwing off projection.x/y (computed from the actual
        // screen width/height) and making the icon land somewhere that
        // doesn't match where it's supposed to be.
        <View
            pointerEvents="box-none"
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }}
        >
            <Text style={{ position: "absolute", top: insets.top + 16, alignSelf: "center", color: "#C8CEF5" }}>
                Follow the arrow to find the {active.name}
            </Text>
            <View ref={arrowRef} style={{ position: "absolute" }}>
                <Text style={{ fontSize: 32, color: "#C8CEF5" }}>▲</Text>
            </View>
        </View>
    );
}
