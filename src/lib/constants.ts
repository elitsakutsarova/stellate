export const DEVICE_ID_KEY = "stellate_device_id";
export const PAIR_ID_KEY = "stellate_pair_id";
export const PAIR_CODE_KEY = "stellate_pair_code";
// per pair, so reconnecting with the same code keeps your time
export const timeTogetherKey = (pairId: string) => `stellate_time_together_${pairId}`;
export const NOTIFICATION_KEYS = {
    reminders: "stellate_notifications",       // sun/moon is up for both of you
    lookUp: "stellate_notifications_lookup",   // your special someone looks up
} as const;
export type NotificationKind = keyof typeof NOTIFICATION_KEYS;
export const SOUND_KEYS = {
    music: "stellate_music",
    chimes: "stellate_chimes",
} as const;
export type SoundKind = keyof typeof SOUND_KEYS;
export const WIDGET_DATA_KEY = "stellate_widget";

export const CHANNELS = { reminders: "sky-reminders", lookUp: "look-up" } as const;

export const pairChannel = (pairId: string) => `pair-${pairId}`;
export const PAIR_CHANGED_EVENT = "pair-changed";
