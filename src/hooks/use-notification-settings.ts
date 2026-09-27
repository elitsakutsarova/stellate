import { useEffect, useRef } from "react";
import { AppState, Linking } from "react-native";
import { usePairStore } from "@/store/use-pair-store";
import { getNotificationPermission, notificationsSupported, requestNotificationPermission } from "@/lib/notifications";
import type { NotificationKind } from "@/lib/constants";

const KINDS: NotificationKind[] = ["reminders", "lookUp"];

// The notification toggles and their permission flow: the OS asks once on the sky
// screen; a toggle asks again, or opens Settings if the OS won't; and the toggles
// switch off if notifications are turned off in Settings.
export function useNotificationSettings() {
    const isHydrated = usePairStore((state) => state.isHydrated);
    const settings = usePairStore((state) => state.notifications);
    const setNotification = usePairStore((state) => state.setNotification);
    const waitingForSettings = useRef<NotificationKind | null>(null);
    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    useEffect(() => {
        if (!isHydrated || !notificationsSupported) return;
        const undecided = KINDS.filter((kind) => settings[kind] === null);
        if (undecided.length === 0) return;
        // only a fresh install gets the popup; a newly added kind follows the permission
        const answer = undecided.length === KINDS.length ? requestNotificationPermission() : getNotificationPermission();
        answer.then(({ granted }) => undecided.forEach((kind) => setNotification(kind, granted)));
    }, [isHydrated, settings, setNotification]);

    // match the toggles to the real permission whenever the app comes to the front
    useEffect(() => {
        if (!notificationsSupported) return;
        const sync = async () => {
            const { granted } = await getNotificationPermission();
            const waiting = waitingForSettings.current;
            waitingForSettings.current = null;
            if (granted && waiting) setNotification(waiting, true);
            if (!granted) KINDS.filter((kind) => settingsRef.current[kind]).forEach((kind) => setNotification(kind, false));
        };
        if (isHydrated) sync();
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active") sync();
        });
        return () => subscription.remove();
    }, [isHydrated, setNotification]);

    const toggle = async (kind: NotificationKind, on: boolean) => {
        if (!on) return setNotification(kind, false);
        const current = await getNotificationPermission();
        if (current.granted) return setNotification(kind, true);
        if (current.canAskAgain) {
            const { granted } = await requestNotificationPermission();
            return setNotification(kind, granted);
        }
        waitingForSettings.current = kind;
        Linking.openSettings();
    };

    return { reminders: !!settings.reminders, lookUp: !!settings.lookUp, toggle, supported: notificationsSupported };
}
