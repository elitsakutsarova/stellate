import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { updateSkyWidget } from "@/widget/widget";
import {
    DEVICE_ID_KEY, PAIR_ID_KEY, PAIR_CODE_KEY, NOTIFICATION_KEYS, SOUND_KEYS, timeTogetherKey, type NotificationKind, type SoundKind,
} from "@/lib/constants";

type PairStore = {
    deviceId: string | null;
    pairId: string | null;
    pairCode: string | null;
    isHydrated: boolean;
    notifications: Record<NotificationKind, boolean | null>;
    secondsTogether: number;
    sound: Record<SoundKind, boolean>;
    hydrate: () => Promise<void>;   // load deviceId + saved pair from AsyncStorage, once
    setPair: (id: string, code: string) => Promise<void>; // save + persist
    clearPair: () => Promise<void>; // disconnect
    setNotification: (kind: NotificationKind, on: boolean) => Promise<void>; // save + persist
    addSecondTogether: () => void;
    setSound: (kind: SoundKind, on: boolean) => Promise<void>;
};

const save = (work: Promise<unknown>) => work.catch((err) => console.warn("Couldn't save:", err));

const loadSecondsTogether = async (pairId: string) =>
    Number(await AsyncStorage.getItem(timeTogetherKey(pairId)).catch(() => null)) || 0;

export const usePairStore = create<PairStore>((set, get) => ({
    deviceId: null,
    pairId: null,
    pairCode: null,
    isHydrated: false,
    notifications: { reminders: null, lookUp: null },
    secondsTogether: 0,
    sound: { music: true, chimes: true },

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
            const secondsTogether = pairId ? await loadSecondsTogether(pairId) : 0;
            const loadSound = async (kind: SoundKind) => (await AsyncStorage.getItem(SOUND_KEYS[kind])) !== "off";
            const sound = { music: await loadSound("music"), chimes: await loadSound("chimes") };
            set({ deviceId, pairId, pairCode, notifications, secondsTogether, sound, isHydrated: true });
        } catch (err) {
            // never leave the app stuck on the launch screen - carry on as a fresh start
            console.warn("Couldn't load saved data:", err);
            set((state) => ({ deviceId: state.deviceId ?? Crypto.randomUUID(), isHydrated: true }));
        }
    },

    // state first, saving is best-effort - a storage error can't block the app
    setPair: async (id, code) => {
        set({ pairId: id, pairCode: code, secondsTogether: 0 });
        await save(AsyncStorage.multiSet([[PAIR_ID_KEY, id], [PAIR_CODE_KEY, code]]));
        const seconds = await loadSecondsTogether(id);
        if (get().pairId === id) set({ secondsTogether: seconds });
    },

    clearPair: async () => {
        set({ pairId: null, pairCode: null, secondsTogether: 0 });
        updateSkyWidget({ paired: false, me: null, them: null, secondsTogether: 0 });
        await save(AsyncStorage.multiRemove([PAIR_ID_KEY, PAIR_CODE_KEY]));
    },

    setNotification: async (kind, on) => {
        set((state) => ({ notifications: { ...state.notifications, [kind]: on } }));
        await save(AsyncStorage.setItem(NOTIFICATION_KEYS[kind], on ? "on" : "off"));
    },

    setSound: async (kind, on) => {
        set((state) => ({ sound: { ...state.sound, [kind]: on } }));
        await save(AsyncStorage.setItem(SOUND_KEYS[kind], on ? "on" : "off"));
    },

    addSecondTogether: () => {
        const { pairId, secondsTogether } = get();
        if (!pairId) return;
        set({ secondsTogether: secondsTogether + 1 });
        save(AsyncStorage.setItem(timeTogetherKey(pairId), String(secondsTogether + 1)));
    },
}));
