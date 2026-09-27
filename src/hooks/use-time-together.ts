import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { timeTogetherKey } from "@/lib/constants";

export function useTimeTogether(pairId: string | null, together: boolean) {
    // remembers which pair the count belongs to, so it's never saved under another
    const [count, setCount] = useState<{ pairId: string; seconds: number } | null>(null);
    const loaded = !!pairId && count?.pairId === pairId;

    useEffect(() => {
        if (!pairId) return;
        let cancelled = false;
        AsyncStorage.getItem(timeTogetherKey(pairId))
            .catch(() => null) // unreadable: count from 0 rather than not at all
            .then((saved) => {
                if (!cancelled) setCount({ pairId, seconds: Number(saved) || 0 });
            });
        return () => {
            cancelled = true;
        };
    }, [pairId]);

    useEffect(() => {
        if (!together || !loaded) return;
        const timer = setInterval(() => setCount((c) => c && { ...c, seconds: c.seconds + 1 }), 1000);
        return () => clearInterval(timer);
    }, [together, loaded]);

    // saved on every tick, so closing the app loses nothing
    useEffect(() => {
        if (count) AsyncStorage.setItem(timeTogetherKey(count.pairId), String(count.seconds)).catch(() => {});
    }, [count]);

    return loaded ? count.seconds : 0;
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
