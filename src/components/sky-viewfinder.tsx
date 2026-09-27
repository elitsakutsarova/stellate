import { useEffect, useRef } from "react";
import { View, Text } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import { projectToScreen, type SkyBody } from "@/hooks/use-sky-bodies";
import type { Vec3 } from "@/hooks/use-device-orientation";
import type { Looking } from "@/hooks/use-pair-presence";
import { COLORS, FONTS, fitScale } from "@/lib/theme";
import { menuIcon } from "@/components/side-menu";
import { ArrowIcon } from "@/components/art";

// how far in from each edge the body's centre must be to count as "looking"
const LOOK_MARGIN = 0.2;

// the arrow hides while any part of a glow is on screen
const GLOW_VISIBLE_PX = 24;

type Props = {
    bodies: SkyBody[];       // both: you can look at either one
    active: SkyBody | null;  // the one the arrow guides you to
    E: Vec3;
    N: Vec3;
    U: Vec3;
    declination: number;
    onLookingChange: (looking: Looking) => void;
};

// Guidance on top of the sky: an edge arrow to the main body when nothing is in
// view, and a haptic tap when the sun or moon comes into view.
export function SkyViewfinder({ bodies, active, E, N, U, declination, onLookingChange }: Props) {
    const { width, height } = useSafeAreaFrame();
    const insets = useSafeAreaInsets();
    const hintSize = 12 * Math.max(1, fitScale(width, height));
    const hintLine = Math.round(hintSize * 1.4);
    const projection = active
        ? projectToScreen(E, N, U, declination, active.bearing, active.altitude, width, height)
        : null;

    // if both are on screen, the one nearer the centre
    const placed = bodies.map((body) => ({
        name: body.name,
        p: projectToScreen(E, N, U, declination, body.bearing, body.altitude, width, height),
    }));
    const anythingInView = placed.some(({ p }) =>
        p.angleFromCenter < 90 &&
        p.x > -GLOW_VISIBLE_PX && p.x < width + GLOW_VISIBLE_PX &&
        p.y > -GLOW_VISIBLE_PX && p.y < height + GLOW_VISIBLE_PX);
    const onScreen = placed
        .filter(({ p }) =>
            p.visible &&
            p.x > width * LOOK_MARGIN && p.x < width * (1 - LOOK_MARGIN) &&
            p.y > height * LOOK_MARGIN && p.y < height * (1 - LOOK_MARGIN))
        .sort((a, b) => a.p.angleFromCenter - b.p.angleFromCenter);
    const lookingAt: Looking = onScreen[0]?.name ?? null;
    const arrowRef = useRef<View | null>(null);
    // kept current every render, so the animation loop never has to restart
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
                // shortest way round, so crossing 0/360 doesn't spin the arrow
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

    useEffect(() => {
        if (lookingAt) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLookingChange(lookingAt);
    }, [lookingAt, onLookingChange]);

    if (!active || !projection || anythingInView) return null;

    return (
        // full screen explicitly, so projection x/y match the screen
        <View
            pointerEvents="box-none"
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }}
        >
            {/* small on phones, growing on tablets; its middle lines up with the ☰ button's */}
            <Text
                style={{
                    position: "absolute", alignSelf: "center",
                    top: insets.top + menuIcon(width, height).center - hintLine / 2,
                    fontFamily: FONTS.regular, fontSize: hintSize, lineHeight: hintLine, color: COLORS.muted,
                }}
            >
                Follow the arrow to find the {active.name}
            </Text>
            <View ref={arrowRef} style={{ position: "absolute" }}>
                <ArrowIcon size={32} color={COLORS.text} />
            </View>
        </View>
    );
}
