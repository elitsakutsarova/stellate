import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import type * as NotificationsModule from "expo-notifications";
import type { Coords } from "@/lib/api";
import type { SkyBody } from "@/hooks/use-sky-bodies";

type BodyName = SkyBody["name"];

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

const reminderContent = (body: BodyName) => ({
    title: `The ${body} is up for both of you`,
    body: "Look up together with your special someone?",
});

const isUp = (body: BodyName, date: Date, where: Coords) =>
    (body === "sun" ? SunCalc.getPosition : SunCalc.getMoonPosition)(date, where.latitude, where.longitude).altitude > 0;
const bothSee = (body: BodyName, date: Date, me: Coords, them: Coords) => isUp(body, date, me) && isUp(body, date, them);
const allowedHour = (date: Date) => date.getHours() >= EARLIEST_HOUR && date.getHours() < LATEST_HOUR;

// The moments to remind you about one body: when "the sun/moon is up for
// both of us, at a decent hour" *starts* — either it just rose for the
// second of you, or it was already up and 9:00 arrives. Checked every 10
// minutes over the next few days, at most one per day. Something that's
// already true right now doesn't count (you're in the app anyway).
export function findSharedTimes(body: BodyName, me: Coords, them: Coords, from = new Date()): Date[] {
    const stepMs = STEP_MINUTES * 60 * 1000;
    const end = from.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000;
    const good = (date: Date) => allowedHour(date) && bothSee(body, date, me, them);

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

// Checks without showing anything. canAskAgain false means the system won't
// show the prompt anymore (Android: after 2 "no"s, iOS: after 1) — only the
// phone's Settings can turn it on then.
export async function getNotificationPermission() {
    if (!Notifications) return { granted: false, canAskAgain: false };
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    return { granted: status === "granted", canAskAgain };
}

// Module-level, like the location permission in use-location.ts: React's
// dev-mode double mount would otherwise fire two requests at once — two
// popups, using up both of Android's chances to ask. A second caller while
// one is in flight shares the same answer instead.
let pendingRequest: Promise<{ granted: boolean; canAskAgain: boolean }> | null = null;

// Shows the system prompt (if the OS still allows asking).
export function requestNotificationPermission() {
    if (!Notifications) return Promise.resolve({ granted: false, canAskAgain: false });
    const notifications = Notifications;
    pendingRequest ??= (async () => {
        await ensureChannel();
        const { status, canAskAgain } = await notifications.requestPermissionsAsync();
        return { granted: status === "granted", canAskAgain };
    })().finally(() => {
        pendingRequest = null;
    });
    return pendingRequest;
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
        for (const body of ["sun", "moon"] as const) {
            for (const date of findSharedTimes(body, me, them)) {
                await Notifications.scheduleNotificationAsync({
                    content: reminderContent(body),
                    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: CHANNEL_ID },
                });
            }
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
            content: reminderContent("moon"),
            trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 10, channelId: CHANNEL_ID },
        });
    });
