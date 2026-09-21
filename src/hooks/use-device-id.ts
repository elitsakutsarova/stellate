import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

const DEVICE_ID_KEY = "stellate_device_id";

export function useDeviceId() {
    const [deviceId, setDeviceId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
                if (!id) {
                    id = Crypto.randomUUID();
                    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
                }
                setDeviceId(id);
            } catch (err) {
                console.error("Failed to load device id", err);
            } finally {
                setIsLoading(false);
            }
        })();
    }, []);

    return { deviceId, isLoading };
}