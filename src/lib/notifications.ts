import { Platform } from "react-native";
import * as SunCalc from "suncalc";
import Constants, { ExecutionEnvironment } from "expo-constants";
import type * as NotificationsModule from "expo-notifications";
import type { Coords } from "@/lib/api";
import { CHANNELS } from "@/lib/constants";
import type { SkyBody } from "@/hooks/use-sky-bodies";

type BodyName = SkyBody["name"];

export const notificationsSupported = !(
    Platform.OS === "android" && Constants.executionEnvironment === ExecutionEnvironment.StoreClient
);
const Notifications: typeof NotificationsModule | null = notificationsSupported
    ? require("expo-notifications")
    : null;

// only asked while the app is open - hide them there; in the background the phone shows them
Notifications?.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
    }),
});


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

function findSharedTimes(body: BodyName, me: Coords, them: Coords, from = new Date()): Date[] {
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

async function ensureChannel() {
    if (!Notifications || Platform.OS !== "android") return;
    await Notifications.setNotificationChannelAsync(CHANNELS.reminders, {
        name: "Sun & moon up for both of you",
        importance: Notifications.AndroidImportance.DEFAULT,
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.lookUp, {
        name: "Your special someone looks up",
        importance: Notifications.AndroidImportance.HIGH,
    });
}

export async function getPushToken(): Promise<string | null> {
    if (!Notifications) return null;
    try {
        await ensureChannel();
        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
        return data;
    } catch (err) {
        console.warn("Couldn't get a push token:", err);
        return null;
    }
}

export async function getNotificationPermission() {
    if (!Notifications) return { granted: false, canAskAgain: false };
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    return { granted: status === "granted", canAskAgain };
}

// shared, so React's dev-mode double mount can't show two popups
let pendingRequest: Promise<{ granted: boolean; canAskAgain: boolean }> | null = null;

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

// Runs one after another, so overlapping reschedules can't leave duplicates.
let queue: Promise<void> = Promise.resolve();
const serialized = (work: () => Promise<void>) => {
    queue = queue.then(work).catch((err) => console.warn("Sky reminders:", err));
    return queue;
};

export const scheduleSkyReminders = (me: Coords, them: Coords) =>
    serialized(async () => {
        if (!Notifications) return;
        await Notifications.cancelAllScheduledNotificationsAsync();
        await ensureChannel();
        for (const body of ["sun", "moon"] as const) {
            for (const date of findSharedTimes(body, me, them)) {
                await Notifications.scheduleNotificationAsync({
                    content: reminderContent(body),
                    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: CHANNELS.reminders },
                });
            }
        }
    });

export const cancelSkyReminders = () =>
    serialized(async () => {
        await Notifications?.cancelAllScheduledNotificationsAsync();
    });

// Debug only
export const sendTestReminder = (body: BodyName) =>
    serialized(async () => {
        if (!Notifications) return;
        await ensureChannel();
        await Notifications.scheduleNotificationAsync({
            content: reminderContent(body),
            trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 10, channelId: CHANNELS.reminders },
        });
    });
