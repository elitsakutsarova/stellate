import { useEffect } from "react";
import { View, Text, Pressable, Alert } from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Share } from "react-native";
import * as Linking from "expo-linking";
import { setPresence } from "@/lib/api";
import { usePairStore } from "@/store/use-pair-store";
import { useLocation } from "@/hooks/use-location";
import { useSkyBodies } from "@/hooks/use-sky-bodies";
import { useDeviceOrientation } from "@/hooks/use-device-orientation";
import { usePairPresence } from "@/hooks/use-pair-presence";
import { SkyViewfinder } from "@/components/sky-viewfinder";

export default function Sky() {
    const router = useRouter();
    const deviceId = usePairStore((state) => state.deviceId);
    const pairId = usePairStore((state) => state.pairId);
    const isHydrated = usePairStore((state) => state.isHydrated);
    const clearPair = usePairStore((state) => state.clearPair);

    const { pair, partnerOnline, partnerLeft, offline } = usePairPresence(isHydrated, deviceId, pairId);

    const { coords, error: locationError, canAskAgain, retry } = useLocation();

    // Pops up whenever the error actually changes (e.g. first denied, or
    // switches from "denied" to "go to Settings") — not on every repeated
    // foreground re-check that still finds the same denial, since setting
    // state to an identical value doesn't trigger a re-render/effect.
    useEffect(() => {
        if (!locationError) return;
        Alert.alert("Location needed", locationError, [
            { text: "Not now", style: "cancel" },
            canAskAgain
                ? { text: "Try again", onPress: retry }
                : { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]);
    }, [locationError, canAskAgain, retry]);

    const { active } = useSkyBodies(coords);
    const { E, N, U, declination } = useDeviceOrientation(!!coords);

    const handleDisconnect = async () => {
        if (pair && deviceId) {
            try {
                await setPresence(pair.id, deviceId, false);
            } catch (err: any) {
                // best-effort — still let them leave locally even if the
                // server couldn't be reached to update presence, so a
                // network hiccup can never trap someone on this screen
                console.warn("Couldn't update presence on disconnect:", err.message);
            }
        }
        await clearPair();
        router.replace("/");
    };

    const confirmDisconnect = () => {
        Alert.alert("Disconnect?", "You'll leave this connection. You can reconnect later with the same code.", [
            { text: "Cancel", style: "cancel" },
            { text: "Disconnect", style: "destructive", onPress: handleDisconnect },
        ]);
    };

    return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 20, padding: 24 }}>
            {locationError && (
                <View style={{ alignItems: "center", gap: 8 }}>
                    <Text style={{ color: "#e63946" }}>{locationError}</Text>
                    <Pressable onPress={canAskAgain ? retry : () => Linking.openSettings()}>
                        <Text style={{ color: "#457b9d" }}>{canAskAgain ? "Try again" : "Open Settings"}</Text>
                    </Pressable>
                </View>
            )}

            <SkyViewfinder active={active} E={E} N={N} U={U} declination={declination} />

            {offline && (
                <Text style={{ color: "#888" }}>Can't reach the server, retrying…</Text>
            )}

            {partnerLeft && (
                <View style={{ backgroundColor: "#f4a26140", padding: 12, borderRadius: 10 }}>
                    <Text>Your partner left this connection.</Text>
                </View>
            )}
            {!partnerLeft && (
                <Text style={{ color: partnerOnline ? "#2a9d8f" : "#888" }}>
                    {partnerOnline ? "● Partner is here now" : "○ Partner isn't in the app right now"}
                </Text>
            )}

            {pair && (
                <View style={{ alignItems: "center", gap: 8 }}>
                    <Text style={{ color: "#888" }}>Room code</Text>
                    <Text style={{ fontSize: 24, fontWeight: "700", letterSpacing: 3 }}>{pair.code}</Text>
                    <View style={{ flexDirection: "row", gap: 16 }}>
                        <Pressable onPress={() => Clipboard.setStringAsync(pair.code)}>
                            <Text style={{ color: "#457b9d" }}>Copy</Text>
                        </Pressable>
                        <Pressable onPress={() => Share.share({ message: `Join me on Stellate: ${pair.code}` })}>
                            <Text style={{ color: "#457b9d" }}>Share</Text>
                        </Pressable>
                    </View>
                </View>
            )}

            <Pressable onPress={confirmDisconnect}>
                <Text style={{ color: "#e63946" }}>Disconnect</Text>
            </Pressable>
        </View>
    );
}
// !!! this disconnect button only disconnects device that triggered it from the pair, but the other connected device is still connected - need to find a way to show them sth like "aw man your soulmate disconnected" - maybe also if it was an accident it can have a reconnect code
// also in table the pair still shows the disconnected device - e.g device_a pressed disconnect => still in Supabase table
