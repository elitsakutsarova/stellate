export const DEVICE_ID_KEY = "stellate_device_id";
export const PAIR_ID_KEY = "stellate_pair_id";
export const PAIR_CODE_KEY = "stellate_pair_code";
// one saved on/off per kind of notification
export const NOTIFICATION_KEYS = {
    reminders: "stellate_notifications",       // sun/moon is up for both of you
    lookUp: "stellate_notifications_lookup",   // your special someone looks up
} as const;
export type NotificationKind = keyof typeof NOTIFICATION_KEYS;

// Android notification channels (the categories people see in system
// settings). Shared with the server, which names the channel in each push.
export const CHANNELS = { reminders: "sky-reminders", lookUp: "look-up" } as const;

// Realtime channel for one pair - shared by the app (listens) and the server
// (announces changes), so the two can never disagree on the name.
export const pairChannel = (pairId: string) => `pair-${pairId}`;
export const PAIR_CHANGED_EVENT = "pair-changed";
