import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, Alert, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { useDeviceId } from "@/hooks/use-device-id";

const PAIR_ID_KEY = "stellate_pair_id";

function generateCode() {
  // this is for the generated connection 6-character code and it has no confusing characters like 0/O or 1/I
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function Index() {
  const router = useRouter();
  const { deviceId, isLoading: deviceLoading } = useDeviceId();
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);

  // this is for if there is already a saved pair and it will skip straight to the sky view
  useEffect(() => {
    (async () => {
      const savedPairId = await AsyncStorage.getItem(PAIR_ID_KEY);
      if (savedPairId) {
        router.replace("/sky");
      } else {
        setCheckingExisting(false);
      }
    })();
  }, []);

  async function handleCreate() {
    if (!deviceId) return;
    setBusy(true);
    const code = generateCode();

    const { data, error } = await supabase
      .from("pairs")
      .insert({ code, device_a: deviceId })
      .select()
      .single();

    setBusy(false);
    if (error || !data) {
      Alert.alert("Something went wrong", error?.message ?? "Please try again.");
      return;
    }

    await AsyncStorage.setItem(PAIR_ID_KEY, data.id);
    Alert.alert("Share this code", code, [
      { text: "Done", onPress: () => router.replace("/sky") },
    ]);
  }

  async function handleJoin() {
    if (!deviceId || joinCode.trim().length === 0) return;
    setBusy(true);

    const { data, error } = await supabase
      .from("pairs")
      .update({ device_b: deviceId })
      .eq("code", joinCode.trim().toUpperCase())
      .is("device_b", null) // this only allows joining if device_b is not already set ( i.e. it is what stops two different people from both claiming the same code)
      .select()
      .single();

    setBusy(false);
    if (error || !data) {
      Alert.alert("Couldn't connect", "Check the code and try again.");
      return;
    }

    await AsyncStorage.setItem(PAIR_ID_KEY, data.id);
    router.replace("/sky");
  }

  if (deviceLoading || checkingExisting) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: "600", textAlign: "center" }}>Stellate</Text>

      <Pressable
        onPress={handleCreate}
        disabled={busy}
        style={{ backgroundColor: "#1d3557", padding: 16, borderRadius: 12 }}
      >
        <Text style={{ color: "white", textAlign: "center" }}>Create a connection</Text>
      </Pressable>

      <Text style={{ textAlign: "center", color: "#888" }}>or</Text>

      <TextInput
        placeholder="Enter a code"
        autoCapitalize="characters"
        value={joinCode}
        onChangeText={setJoinCode}
        style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 12, padding: 16, textAlign: "center" }}
      />

      <Pressable
        onPress={handleJoin}
        disabled={busy}
        style={{ backgroundColor: "#457b9d", padding: 16, borderRadius: 12 }}
      >
        <Text style={{ color: "white", textAlign: "center" }}>Join a connection</Text>
      </Pressable>
    </View>
  );
}