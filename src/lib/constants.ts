export const DEVICE_ID_KEY = "stellate_device_id";
export const PAIR_ID_KEY = "stellate_pair_id";
export const PAIR_CODE_KEY = "stellate_pair_code";
export const NOTIFICATION_KEYS = {
    reminders: "stellate_notifications",       // sun/moon is up for both of you
    lookUp: "stellate_notifications_lookup",   // your special someone looks up
} as const;
export type NotificationKind = keyof typeof NOTIFICATION_KEYS;

// Android notification channels - the server names one in each push.
export const CHANNELS = { reminders: "sky-reminders", lookUp: "look-up" } as const;

// Shared by the app and the server, so they can't disagree on the name.
export const pairChannel = (pairId: string) => `pair-${pairId}`;
export const PAIR_CHANGED_EVENT = "pair-changed";
