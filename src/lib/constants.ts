export const DEVICE_ID_KEY = "stellate_device_id";
export const PAIR_ID_KEY = "stellate_pair_id";
export const PAIR_CODE_KEY = "stellate_pair_code";

// Realtime channel for one pair — shared by the app (listens) and the server
// (announces changes), so the two can never disagree on the name.
export const pairChannel = (pairId: string) => `pair-${pairId}`;
export const PAIR_CHANGED_EVENT = "pair-changed";
