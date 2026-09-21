import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PAIR_ID_KEY } from "@/lib/constants";

export default function Sky() {
    const router = useRouter();

    async function handleDisconnect() {
        await AsyncStorage.removeItem(PAIR_ID_KEY);
        router.replace("/");
    }

    return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 24 }}>
            <Text>Sky view coming soon</Text>
            <Pressable onPress={handleDisconnect}>
                <Text style={{ color: "#e63946" }}>Disconnect</Text>
            </Pressable>
        </View>
    );
}

// !!! this disconnect button only disconnects device that triggered it from the pair, but the other connected device is still connected - need to find a way to show them sth like "aw man your soulmate disconnected" - maybe also if it was an accident it can have a reconnect code
// also in table the pair still shows the disconnected device - e.g device_a pressed disconnect => still in Supabase table