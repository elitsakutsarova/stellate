import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { useAnimatedReaction, useAnimatedStyle, useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import { projector, type SkyBody } from "@/hooks/use-sky-bodies";
import type { Basis } from "@/hooks/use-device-orientation";
import type { Looking } from "@/hooks/use-pair-presence";
import { COLORS, FONTS, fitScale } from "@/lib/theme";
import { menuIcon } from "@/components/side-menu";
import { ArrowIcon } from "@/components/art";

// how far in from each edge the body's centre must be to count as "looking"
const LOOK_MARGIN = 0.2;

// the arrow hides while any part of a glow is on screen
const GLOW_VISIBLE_PX = 24;

// each frame, the arrow moves this share of the way to where it should be
const ARROW_EASE = 0.1;

type Props = {
    bodies: SkyBody[];
    active: SkyBody | null;
    basis: SharedValue<Basis>;
    declination: number;
    onLookingChange: (looking: Looking) => void;
};

export function SkyViewfinder({ bodies, active, basis, declination, onLookingChange }: Props) {
    const { width, height } = useSafeAreaFrame();
    const insets = useSafeAreaInsets();
    const hintSize = 12 * Math.max(1, fitScale(width, height));
    const hintLine = Math.round(hintSize * 1.4);

    const [anythingInView, setAnythingInView] = useState(false);

    const handleLooking = (looking: Looking) => {
        if (looking) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLookingChange(looking);
    };
    const reported = useSharedValue<Looking | undefined>(undefined);

    useAnimatedReaction(
        () => {
            const at = projector(basis.value, declination, width, height);
            let looking: Looking = null;
            let nearest = Infinity;
            let inView = false;
            for (const body of bodies) {
                const p = at(body.bearing, body.altitude);
                if (p.angleFromCenter < 90 &&
                    p.x > -GLOW_VISIBLE_PX && p.x < width + GLOW_VISIBLE_PX &&
                    p.y > -GLOW_VISIBLE_PX && p.y < height + GLOW_VISIBLE_PX) inView = true;
                // if both are well inside the screen, the one nearer the centre
                if (p.visible &&
                    p.x > width * LOOK_MARGIN && p.x < width * (1 - LOOK_MARGIN) &&
                    p.y > height * LOOK_MARGIN && p.y < height * (1 - LOOK_MARGIN) &&
                    p.angleFromCenter < nearest) {
                    nearest = p.angleFromCenter;
                    looking = body.name;
                }
            }
            return { looking, inView };
        },
        (now, before) => {
            if (now.looking !== reported.value) {
                reported.value = now.looking;
                scheduleOnRN(handleLooking, now.looking);
            }
            if (now.inView !== before?.inView) scheduleOnRN(setAnythingInView, now.inView);
        },
        [bodies, declination, width, height, handleLooking]
    );

    const aim = useSharedValue<{ bearing: number; altitude: number; declination: number } | null>(null);
    useEffect(() => {
        aim.value = active ? { bearing: active.bearing, altitude: active.altitude, declination } : null;
    }, [active?.bearing, active?.altitude, declination, aim]);
    const arrow = useSharedValue({ x: 0, y: 0, deg: 0, placed: false });

    useFrameCallback(() => {
        const t = aim.value;
        if (!t) return;
        const p = projector(basis.value, t.declination, width, height)(t.bearing, t.altitude);
        const a = arrow.value;
        if (!a.placed) {
            arrow.value = { x: p.arrowX, y: p.arrowY, deg: p.arrowDeg, placed: true };
            return;
        }
        // shortest way round, so crossing 0/360 doesn't spin the arrow
        const turn = ((p.arrowDeg - a.deg + 540) % 360) - 180;
        arrow.value = {
            x: a.x + (p.arrowX - a.x) * ARROW_EASE,
            y: a.y + (p.arrowY - a.y) * ARROW_EASE,
            deg: a.deg + turn * ARROW_EASE,
            placed: true,
        };
    });

    const arrowStyle = useAnimatedStyle(() => ({
        left: arrow.value.x - 16,
        top: arrow.value.y - 16,
        transform: [{ rotate: `${arrow.value.deg}deg` }],
    }));

    if (!active || anythingInView) return null;

    return (
        <View
            pointerEvents="box-none"
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }}
        >
            <Text
                style={{
                    position: "absolute", alignSelf: "center",
                    top: insets.top + menuIcon(width, height).center - hintLine / 2,
                    fontFamily: FONTS.regular, fontSize: hintSize, lineHeight: hintLine, color: COLORS.muted,
                }}
            >
                Follow the arrow to find the {active.name}
            </Text>
            <Animated.View style={[{ position: "absolute" }, arrowStyle]}>
                <ArrowIcon size={32} color={COLORS.text} />
            </Animated.View>
        </View>
    );
}
