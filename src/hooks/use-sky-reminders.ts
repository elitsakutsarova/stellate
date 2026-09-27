import { useEffect } from "react";
import { cancelSkyReminders, scheduleSkyReminders } from "@/lib/notifications";
import type { Coords } from "@/lib/api";

// ~10 km, like the server, so small GPS changes don't re-plan everything
const rough = (degrees: number) => Math.round(degrees * 10) / 10;

export function useSkyReminders(enabled: boolean, me: Coords | null, them: Coords | null) {
    const myLat = me && rough(me.latitude), myLon = me && rough(me.longitude);
    const theirLat = them && rough(them.latitude), theirLon = them && rough(them.longitude);

    useEffect(() => {
        if (!enabled || myLat === null || myLon === null || theirLat === null || theirLon === null) {
            cancelSkyReminders();
            return;
        }
        scheduleSkyReminders({ latitude: myLat, longitude: myLon }, { latitude: theirLat, longitude: theirLon });
    }, [enabled, myLat, myLon, theirLat, theirLon]);
}
