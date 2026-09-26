import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import type * as NotificationsModule from "expo-notifications";
import type { Coords } from "@/lib/api";

// Expo Go on Android (SDK 53+) throws as soon as expo-notifications is even
// imported, which would crash the whole sky screen. So it's only loaded
// where it works (a development/real build, or iOS); everywhere else the
// reminders simply switch off and every function below does nothing.
export const notificationsSupported = !(
    Platform.OS === "android" && Constants.executionEnvironment === ExecutionEnvironment.StoreClient
);
const Notifications: typeof NotificationsModule | null = notificationsSupported
    ? require("expo-notifications")
    : null;

// By default a notification is hidden while the app is open — show it
// anyway, so it's never silently swallowed. (Sound must be on: on Android,
// shouldPlaySound: false hides the drop-down banner entirely.)
Notifications?.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
    }),
});

const SunCalc = require("suncalc");

const CHANNEL_ID = "sky-reminders";
const DAYS_AHEAD = 3;      // how far ahead reminders are planned (redone on every app open)
const STEP_MINUTES = 10;   // how finely we check the sky
const EARLIEST_HOUR = 9;   // no reminders before 9:00…
const LATEST_HOUR = 23;    // …or from 23:00 on (your local time)

const REMINDER_CONTENT = {
    title: "The moon is up for both of you",
    body: "Look up together with your special someone?",
};

const moonIsUp = (date: Date, where: Coords) =>
    SunCalc.getMoonPosition(date, where.latitude, where.longitude).altitude > 0;
const bothSeeMoon = (date: Date, me: Coords, them: Coords) => moonIsUp(date, me) && moonIsUp(date, them);
const allowedHour = (date: Date) => date.getHours() >= EARLIEST_HOUR && date.getHours() < LATEST_HOUR;

// The moments to remind you: when "the moon is up for both of us, at a
// decent hour" *starts* — either it just rose for the second of you, or it
// was already up overnight and 9:00 arrives. Checked every 10 minutes over
// the next few days, at most one per day. Something that's already true
// right now doesn't count (you're in the app anyway).
export function findSharedMoonTimes(me: Coords, them: Coords, from = new Date()): Date[] {
    const stepMs = STEP_MINUTES * 60 * 1000;
    const end = from.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000;
    const good = (date: Date) => allowedHour(date) && bothSeeMoon(date, me, them);

    const times: Date[] = [];
    let wasGood = good(from);
    let lastDay = "";
    for (let t = from.getTime() + stepMs; t < end; t += stepMs) {
        const date = new Date(t);
        const isGood = good(date);
        if (isGood && !wasGood && date.toDateString() !== lastDay) {
            times.push(date);
            lastDay = date.toDateString();
        }
        wasGood = isGood;
    }
    return times;
}

// Android needs a "channel" (the category users see in system settings)
// before it will show the permission prompt or any notification.
async function ensureChannel() {
    if (!Notifications || Platform.OS !== "android") return;
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: "Sky reminders",
        importance: Notifications.AndroidImportance.DEFAULT,
    });
}

// Shows the system prompt (if the OS still allows asking). canAskAgain false
// means the person blocked it — only Settings can turn it back on.
export async function requestNotificationPermission() {
    if (!Notifications) return { granted: false, canAskAgain: false };
    await ensureChannel();
    const { status, canAskAgain } = await Notifications.requestPermissionsAsync();
    return { granted: status === "granted", canAskAgain };
}

// Scheduling is async and can be triggered again before it finishes (e.g.
// both locations arriving at once). Chaining every run onto the previous one
// means they never overlap — otherwise two runs could both clear and then
// both schedule, leaving duplicate reminders.
let queue: Promise<void> = Promise.resolve();
const serialized = (work: () => Promise<void>) => {
    queue = queue.then(work).catch((err) => console.warn("Sky reminders:", err));
    return queue;
};

// Replaces all planned reminders with fresh ones for these two locations.
export const scheduleSkyReminders = (me: Coords, them: Coords) =>
    serialized(async () => {
        if (!Notifications) return;
        await Notifications.cancelAllScheduledNotificationsAsync();
        await ensureChannel();
        for (const date of findSharedMoonTimes(me, them)) {
            await Notifications.scheduleNotificationAsync({
                content: REMINDER_CONTENT,
                trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: CHANNEL_ID },
            });
        }
    });

export const cancelSkyReminders = () =>
    serialized(async () => {
        await Notifications?.cancelAllScheduledNotificationsAsync();
    });

// Development only: the same reminder, 10 seconds from now — to check that
// notifications actually arrive without waiting for a real moonrise.
// (Doesn't clear the real planned ones.)
export const sendTestReminder = () =>
    serialized(async () => {
        if (!Notifications) return;
        await ensureChannel();
        await Notifications.scheduleNotificationAsync({
            content: REMINDER_CONTENT,
            trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 10, channelId: CHANNEL_ID },
        });
    });
