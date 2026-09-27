import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { DEVICE_ID_KEY, PAIR_ID_KEY, PAIR_CODE_KEY, NOTIFICATION_KEYS, type NotificationKind } from "@/lib/constants";

type PairStore = {
    deviceId: string | null;
    pairId: string | null;
    pairCode: string | null;
    isHydrated: boolean;
    notifications: Record<NotificationKind, boolean | null>;
    hydrate: () => Promise<void>;   // load deviceId + saved pair from AsyncStorage, once
    setPair: (id: string, code: string) => Promise<void>; // save + persist
    clearPair: () => Promise<void>; // disconnect
    setNotification: (kind: NotificationKind, on: boolean) => Promise<void>; // save + persist
};

const save = (work: Promise<unknown>) => work.catch((err) => console.warn("Couldn't save:", err));

export const usePairStore = create<PairStore>((set) => ({
    deviceId: null,
    pairId: null,
    pairCode: null,
    isHydrated: false,
    notifications: { reminders: null, lookUp: null },

    hydrate: async () => {
        try {
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
        } catch (err) {
            // never leave the app stuck on the launch screen - carry on as a fresh start
            console.warn("Couldn't load saved data:", err);
            set((state) => ({ deviceId: state.deviceId ?? Crypto.randomUUID(), isHydrated: true }));
        }
    },

    // The app updates straight away; saving is best-effort, so a storage hiccup can't
    // block connecting, disconnecting or a toggle.
    setPair: async (id, code) => {
        set({ pairId: id, pairCode: code });
        await save(AsyncStorage.multiSet([[PAIR_ID_KEY, id], [PAIR_CODE_KEY, code]]));
    },

    clearPair: async () => {
        set({ pairId: null, pairCode: null });
        await save(AsyncStorage.multiRemove([PAIR_ID_KEY, PAIR_CODE_KEY]));
    },

    setNotification: async (kind, on) => {
        set((state) => ({ notifications: { ...state.notifications, [kind]: on } }));
        await save(AsyncStorage.setItem(NOTIFICATION_KEYS[kind], on ? "on" : "off"));
    },
}));
