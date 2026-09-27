import { useEffect, useRef, useState } from "react";
import { Animated, Easing } from "react-native";

const GLIDE_MS = 1200;

// Eases towards `target` instead of jumping (the sky's colours change smoothly when the
// sun moves or a debug preset is picked). The first known value is taken straight away.
export function useGlide(target: number | undefined) {
    const anim = useRef(new Animated.Value(target ?? 0)).current; // starts where the target is
    const [value, setValue] = useState<number | undefined>(target);
    const started = useRef(target !== undefined);

    useEffect(() => {
        const id = anim.addListener(({ value }) => setValue(value));
        return () => anim.removeListener(id);
    }, [anim]);

    useEffect(() => {
        if (target === undefined) return;
        if (!started.current) {
            started.current = true;
            anim.setValue(target);
            return;
        }
        Animated.timing(anim, { toValue: target, duration: GLIDE_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start();
    }, [target, anim]);

    return value;
}
