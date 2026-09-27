import { useEffect } from "react";
import { cancelSkyReminders, scheduleSkyReminders } from "@/lib/notifications";
import type { Coords } from "@/lib/api";
import { roughly as rough } from "@/lib/geo";

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
