import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, Alert, ActivityIndicator, Share } from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { createPair, joinPair } from "@/lib/api";
import { usePairStore } from "@/store/use-pair-store";
import { StyleSheet } from "react-native";

export default function Index() {
  const router = useRouter();
  const deviceId = usePairStore((state) => state.deviceId);
  const pairId = usePairStore((state) => state.pairId);
  const isHydrated = usePairStore((state) => state.isHydrated);
  const setPair = usePairStore((state) => state.setPair);
  const [joinCode, setJoinCode] = useState("");
  const [pendingPair, setPendingPair] = useState<{ id: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // this is for if there is already a saved pair and it will skip straight to the sky view
  useEffect(() => {
    if (isHydrated && pairId) {
      router.replace("/sky");
    }
  }, [isHydrated, pairId, router]);

  const handleCreate = async () => {
    if (!deviceId) return;
    setBusy(true);
    try {
      const pair = await createPair(deviceId);
      setPendingPair(pair); // show the code screen, don't jump in yet
    } catch (err: any) {
      Alert.alert("Something went wrong", err.message);
    }
    setBusy(false);
  };

  const handleJoin = async () => {
    if (!deviceId || joinCode.trim().length === 0) return;
    setBusy(true);
    try {
      const { id, code } = await joinPair(joinCode.trim().toUpperCase(), deviceId);
      await setPair(id, code);
      router.replace("/sky");
    } catch (err: any) {
      Alert.alert("Couldn't connect", err.message);
    }
    setBusy(false);
  };

  if (!isHydrated || pairId) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (pendingPair) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16 }}>
        <Text style={{ fontSize: 18, textAlign: "center" }}>Share this code</Text>
        <Text style={{ fontSize: 40, fontWeight: "700", textAlign: "center", letterSpacing: 4 }}>
          {pendingPair.code}
        </Text>

        <Pressable
          onPress={async () => {
            await Clipboard.setStringAsync(pendingPair.code);
            Alert.alert("Copied");
          }}
          style={{ backgroundColor: "#457b9d", padding: 16, borderRadius: 12 }}
        >
          <Text style={{ color: "white", textAlign: "center" }}>Copy code</Text>
        </Pressable>

        <Pressable
          onPress={() => Share.share({ message: `Join me on Stellate: ${pendingPair.code}` })}
          style={{ backgroundColor: "#457b9d", padding: 16, borderRadius: 12 }}
        >
          <Text style={{ color: "white", textAlign: "center" }}>Send to someone</Text>
        </Pressable>

        <Pressable
          onPress={async () => {
            await setPair(pendingPair.id, pendingPair.code);
            router.replace("/sky");
          }}
          style={{ padding: 16 }}
        >
          <Text style={{ textAlign: "center", color: "#888" }}>Done</Text>
        </Pressable>
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
        onSubmitEditing={handleJoin}
        returnKeyType="done"
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

// possibly add a stylesheet for the inline styles