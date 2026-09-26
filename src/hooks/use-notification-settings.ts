import { useEffect, useRef } from "react";
import { AppState, Linking } from "react-native";
import { usePairStore } from "@/store/use-pair-store";
import { getNotificationPermission, notificationsSupported, requestNotificationPermission } from "@/lib/notifications";
import type { NotificationKind } from "@/lib/constants";

const KINDS: NotificationKind[] = ["reminders", "lookUp"];

// The on/off toggles for each kind of notification, and the permission flow
// behind them (one system permission covers both):
// - The system asks once, the first time the sky screen opens; the answer
//   sets every toggle. Saying no is fine - no nagging.
// - Turning a toggle on later asks again; if the system won't show the prompt
//   anymore, it opens the phone's Settings, and the toggle switches on by
//   itself once you come back with it allowed.
// - The toggles never lie: if notifications get switched off for Stellate in
//   the phone's Settings, they show off too.
export function useNotificationSettings() {
    const isHydrated = usePairStore((state) => state.isHydrated);
    const settings = usePairStore((state) => state.notifications);
    const setNotification = usePairStore((state) => state.setNotification);
    // which toggle sent the person to Settings (if any)
    const waitingForSettings = useRef<NotificationKind | null>(null);
    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    // first visit: ask once, remember the answer for every kind not decided yet
    useEffect(() => {
        if (!isHydrated || !notificationsSupported) return;
        const undecided = KINDS.filter((kind) => settings[kind] === null);
        if (undecided.length === 0) return;
        // only a brand-new install gets the popup; a kind that's merely new
        // (added in an update) just follows the current permission, silently
        const answer = undecided.length === KINDS.length ? requestNotificationPermission() : getNotificationPermission();
        answer.then(({ granted }) => undecided.forEach((kind) => setNotification(kind, granted)));
    }, [isHydrated, settings, setNotification]);

    // Match the toggles to what the phone actually allows - on opening the
    // screen and every time the app comes back to the front.
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
        // the system won't ask anymore - Settings is the only way
        waitingForSettings.current = kind;
        Linking.openSettings();
    };

    return { reminders: !!settings.reminders, lookUp: !!settings.lookUp, toggle, supported: notificationsSupported };
}
