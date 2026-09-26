import { useEffect, useState } from "react";
import { usePairStore } from "@/store/use-pair-store";
import {
    cancelSkyReminders, notificationsSupported, requestNotificationPermission, scheduleSkyReminders,
} from "@/lib/sky-reminders";
import type { Coords } from "@/lib/api";

// ~10 km, same as the server — so small GPS changes don't re-plan everything
const rough = (degrees: number) => Math.round(degrees * 10) / 10;

// Keeps the planned "moon is up for both of you" reminders in sync with the
// on/off setting and both locations, and asks for permission exactly once
// (the first time the sky screen opens). Declining is fine — no nagging;
// the side menu toggle is the way to turn it on later.
export function useSkyReminders(me: Coords | null, them: Coords | null) {
    const isHydrated = usePairStore((state) => state.isHydrated);
    const enabled = usePairStore((state) => state.notificationsEnabled);
    const setEnabled = usePairStore((state) => state.setNotificationsEnabled);
    // the OS won't show the prompt anymore — only phone Settings can fix it
    const [blocked, setBlocked] = useState(false);

    const turnOn = async () => {
        const { granted, canAskAgain } = await requestNotificationPermission();
        setBlocked(!granted && !canAskAgain);
        await setEnabled(granted);
    };

    useEffect(() => {
        if (isHydrated && enabled === null && notificationsSupported) turnOn();
    }, [isHydrated, enabled]);

    const myLat = me && rough(me.latitude), myLon = me && rough(me.longitude);
    const theirLat = them && rough(them.latitude), theirLon = them && rough(them.longitude);
    useEffect(() => {
        if (!enabled || myLat === null || myLon === null || theirLat === null || theirLon === null) {
            cancelSkyReminders();
            return;
        }
        scheduleSkyReminders({ latitude: myLat, longitude: myLon }, { latitude: theirLat, longitude: theirLon });
    }, [enabled, myLat, myLon, theirLat, theirLon]);

    const toggle = (on: boolean) => (on ? turnOn() : setEnabled(false));
    return { enabled: !!enabled, blocked, toggle, supported: notificationsSupported };
}
