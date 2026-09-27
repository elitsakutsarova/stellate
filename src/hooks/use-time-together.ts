import { useEffect } from "react";
import { usePairStore } from "@/store/use-pair-store";

// Counts a second every second while you're both looking up. The count itself lives in
// the pair store (loaded with the pair, saved on every tick); this is only the clock.
export function useTimeTogether(together: boolean) {
    const addSecond = usePairStore((state) => state.addSecondTogether);
    useEffect(() => {
        if (!together) return;
        const timer = setInterval(addSecond, 1000);
        return () => clearInterval(timer);
    }, [together, addSecond]);
    return usePairStore((state) => state.secondsTogether);
}

// 45 s, 4 min 07 s, 1 h 12 min
export function formatDuration(total: number) {
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) return `${hours} h ${minutes} min`;
    if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
    return `${seconds} s`;
}
