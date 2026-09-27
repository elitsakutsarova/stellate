import { useEffect } from "react";
import { usePairStore } from "@/store/use-pair-store";

// the clock for time together; the count itself lives in the pair store
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
