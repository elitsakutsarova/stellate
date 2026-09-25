import { useEffect, useRef } from "react";
import { View, Text, useWindowDimensions } from "react-native";
import * as Haptics from "expo-haptics";
import { projectToScreen } from "@/hooks/use-sky-bodies";
import type { Vec3 } from "@/hooks/use-device-orientation";

type ActiveBody = { name: "sun" | "moon"; altitude: number; bearing: number; visible: boolean };

type Props = {
    active: ActiveBody | null;
    E: Vec3;
    N: Vec3;
    U: Vec3;
    declination: number;
};

// The AR-style sky icon/arrow: projects the sun/moon onto the screen from
// the device's current attitude, smooths that position every frame, and
// gives a haptic tap the moment it's centered. Self-contained — sky.tsx
// only needs to know where the target is (active) and which way the
// device is pointing (E/N/U/declination), not how any of this works.
export function SkyViewfinder({ active, E, N, U, declination }: Props) {
    const { width, height } = useWindowDimensions();
    const projection = active
        ? projectToScreen(E, N, U, declination, active.bearing, active.altitude, width, height)
        : null;

    const isAligned = projection ? projection.visible && projection.angleFromCenter < 8 : false;
    const wasAligned = useRef(false);
    const iconRef = useRef<View | null>(null);
    const arrowRef = useRef<View | null>(null);
    // Kept in sync every render (not via an effect) so the animation loop
    // below can always read the latest projection without needing to
    // restart — projection is a new object every render, so depending on
    // it directly would tear down and reset the loop on every sensor tick.
    const projectionRef = useRef(projection);
    projectionRef.current = projection;
    const targetPos = useRef({ x: projection?.x ?? 0, y: projection?.y ?? 0 });
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
            targetPos.current.x += ((p?.x ?? targetPos.current.x) - targetPos.current.x) * 0.1;
            targetPos.current.y += ((p?.y ?? targetPos.current.y) - targetPos.current.y) * 0.1;
            iconRef.current?.setNativeProps({
                style: {
                    left: targetPos.current.x - 24,
                    top: targetPos.current.y - 24,
                    transform: [{ rotate: `${p?.iconRotation ?? 0}deg` }],
                },
            });

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

    useEffect(() => {
        if (isAligned && !wasAligned.current) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        wasAligned.current = isAligned;
    }, [isAligned]);

    if (!active) return null;

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
            {/* temporary debug readout — remove once this locks on reliably */}
            <Text style={{ position: "absolute", top: 8, left: 12, color: "#888", fontSize: 12 }}>
                {active.name} target az {active.bearing.toFixed(0)}° alt {active.altitude.toFixed(0)}°{"\n"}
                diff {projection?.angleFromCenter.toFixed(0)}° · declination {declination.toFixed(0)}°
            </Text>
            {projection && (
                <Text style={{ position: "absolute", bottom: 40, alignSelf: "center", color: "#888" }}>
                    Turn your phone to device around
                </Text>
            )}
            {projection && !projection.visible && (
                <View ref={arrowRef} style={{ position: "absolute" }}>
                    <Text style={{ fontSize: 32, color: "#888" }}>▲</Text>
                </View>
            )}
            {projection?.visible && (
                <View ref={iconRef} style={{ position: "absolute", zIndex: 10 }}>
                    <Text style={{ fontSize: 48 }}>
                        {active.name === "sun" ? "☀️" : "🌙"}
                    </Text>
                </View>
            )}
        </View>
    );
}
