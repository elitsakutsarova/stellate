import { useEffect, useRef } from "react";
import { AppState, Linking } from "react-native";
import { usePairStore } from "@/store/use-pair-store";
import {
    cancelSkyReminders, getNotificationPermission, notificationsSupported,
    requestNotificationPermission, scheduleSkyReminders,
} from "@/lib/sky-reminders";
import type { Coords } from "@/lib/api";

// ~10 km, same as the server — so small GPS changes don't re-plan everything
const rough = (degrees: number) => Math.round(degrees * 10) / 10;

// Keeps the planned "sun/moon is up for both of you" reminders in sync with
// the on/off setting and both locations.
// Permission flow: the system asks once, the first time the sky screen opens.
// Saying no is fine — no nagging. Turning the toggle on later asks again; if
// the system won't show the prompt anymore, it opens the phone's Settings,
// and the toggle switches on by itself once you come back with it allowed.
// The toggle never lies: if notifications get switched off for Stellate in
// the phone's Settings, it shows off too.
export function useSkyReminders(me: Coords | null, them: Coords | null) {
    const isHydrated = usePairStore((state) => state.isHydrated);
    const enabled = usePairStore((state) => state.notificationsEnabled);
    const setEnabled = usePairStore((state) => state.setNotificationsEnabled);
    // true while we've sent the person to Settings to allow notifications
    const waitingForSettings = useRef(false);

    // first visit: ask once, remember the answer
    useEffect(() => {
        if (!isHydrated || enabled !== null || !notificationsSupported) return;
        requestNotificationPermission().then(({ granted }) => setEnabled(granted));
    }, [isHydrated, enabled, setEnabled]);

    // Match the toggle to what the phone actually allows — on opening the
    // screen and every time the app comes back to the front:
    // - back from Settings we sent them to, and it's allowed -> on
    // - it's on, but notifications were turned off in Settings -> off
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;
    useEffect(() => {
        if (!notificationsSupported) return;
        const sync = async () => {
            const { granted } = await getNotificationPermission();
            if (granted && waitingForSettings.current) setEnabled(true);
            else if (!granted && enabledRef.current) setEnabled(false);
            waitingForSettings.current = false;
        };
        if (isHydrated) sync();
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active") sync();
        });
        return () => subscription.remove();
    }, [isHydrated, setEnabled]);

    const toggle = async (on: boolean) => {
        if (!on) return setEnabled(false);
        const current = await getNotificationPermission();
        if (current.granted) return setEnabled(true);
        if (current.canAskAgain) {
            const { granted } = await requestNotificationPermission();
            return setEnabled(granted);
        }
        // the system won't ask anymore — Settings is the only way
        waitingForSettings.current = true;
        Linking.openSettings();
    };

    const myLat = me && rough(me.latitude), myLon = me && rough(me.longitude);
    const theirLat = them && rough(them.latitude), theirLon = them && rough(them.longitude);
    useEffect(() => {
        if (!enabled || myLat === null || myLon === null || theirLat === null || theirLon === null) {
            cancelSkyReminders();
            return;
        }
        scheduleSkyReminders({ latitude: myLat, longitude: myLon }, { latitude: theirLat, longitude: theirLon });
    }, [enabled, myLat, myLon, theirLat, theirLon]);

    return { enabled: !!enabled, toggle, supported: notificationsSupported };
}
