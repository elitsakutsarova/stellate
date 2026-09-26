import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { DEVICE_ID_KEY, PAIR_ID_KEY, PAIR_CODE_KEY, NOTIFICATION_KEYS, type NotificationKind } from "@/lib/constants";

type PairStore = {
    deviceId: string | null;
    pairId: string | null;
    pairCode: string | null;
    isHydrated: boolean;
    // each kind on/off; null = never decided yet (so we ask exactly once)
    notifications: Record<NotificationKind, boolean | null>;
    hydrate: () => Promise<void>;   // load deviceId + saved pair from AsyncStorage, once
    setPair: (id: string, code: string) => Promise<void>; // save + persist
    clearPair: () => Promise<void>; // disconnect
    setNotification: (kind: NotificationKind, on: boolean) => Promise<void>; // save + persist
};

export const usePairStore = create<PairStore>((set) => ({
    deviceId: null,
    pairId: null,
    pairCode: null,
    isHydrated: false,
    notifications: { reminders: null, lookUp: null },

    hydrate: async () => {
        let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
        if (!deviceId) {
            deviceId = Crypto.randomUUID();
            await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
        }
        const pairId = await AsyncStorage.getItem(PAIR_ID_KEY);
        const pairCode = await AsyncStorage.getItem(PAIR_CODE_KEY);
        const load = async (kind: NotificationKind) => {
            const saved = await AsyncStorage.getItem(NOTIFICATION_KEYS[kind]);
            return saved === null ? null : saved === "on";
        };
        const notifications = { reminders: await load("reminders"), lookUp: await load("lookUp") };
        set({ deviceId, pairId, pairCode, notifications, isHydrated: true });
    },

    setPair: async (id, code) => {
        await AsyncStorage.setItem(PAIR_ID_KEY, id);
        await AsyncStorage.setItem(PAIR_CODE_KEY, code);
        set({ pairId: id, pairCode: code });
    },

    clearPair: async () => {
        await AsyncStorage.removeItem(PAIR_ID_KEY);
        await AsyncStorage.removeItem(PAIR_CODE_KEY);
        set({ pairId: null, pairCode: null });
    },

    setNotification: async (kind, on) => {
        await AsyncStorage.setItem(NOTIFICATION_KEYS[kind], on ? "on" : "off");
        set((state) => ({ notifications: { ...state.notifications, [kind]: on } }));
    },
}));
