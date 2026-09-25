import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, Alert, ActivityIndicator, Share } from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { supabase } from "@/lib/supabase";
import { usePairStore } from "@/store/use-pair-store";
import { StyleSheet } from "react-native";

const generateCode = () => {
  // this is for the generated connection 6-character code and it has no confusing characters like 0/O or 1/I
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};

export default function Index() {
  const router = useRouter();
  const deviceId = usePairStore((state) => state.deviceId);
  const pairId = usePairStore((state) => state.pairId);
  const isHydrated = usePairStore((state) => state.isHydrated);
  const setPair = usePairStore((state) => state.setPair);
  const [joinCode, setJoinCode] = useState("");
  const [pendingCode, setPendingCode] = useState<string | null>(null);
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

    // This removes any codes a device generated but never got joined
    await supabase.from("pairs").delete().eq("device_a", deviceId).is("device_b", null);

    const code = generateCode();
    const { error } = await supabase.from("pairs").insert({ code, device_a: deviceId });

    setBusy(false);
    if (error) {
      Alert.alert("Something went wrong", error.message);
      return;
    }
    setPendingCode(code); // show the code screen, don't jump in yet
  };

  const handleJoin = async () => {
    if (!deviceId || joinCode.trim().length === 0) return;
    setBusy(true);
    const code = joinCode.trim().toUpperCase();

    const { data: existing, error: fetchError } = await supabase
      .from("pairs")
      .select("*")
      .eq("code", code)
      .single();

    if (fetchError || !existing) {
      setBusy(false);
      Alert.alert("Couldn't connect", "Check the code and try again.");
      return;
    }

    // Option to reconnect to existing pair
    if (existing.device_a === deviceId || existing.device_b === deviceId) {
      const amI_A = existing.device_a === deviceId;
      await supabase
        .from("pairs")
        .update(amI_A ? { device_a_active: true } : { device_b_active: true })
        .eq("id", existing.id);

      await setPair(existing.id, existing.code);
      setBusy(false);
      router.replace("/sky");
      return;
    }

    // Generated code with unclaimed device_b, so someone can join it; !!! technically if someone has the code they can "steal" the spot from the other person if they haven't joined yet
    if (!existing.device_b) {
      const { data, error } = await supabase
        .from("pairs")
        .update({ device_b: deviceId })
        .eq("id", existing.id)
        .is("device_b", null) // this only allows joining if device_b is not already set ( i.e. it is what stops two different people from both claiming the same code)
        .select()
        .single();

      setBusy(false);
      if (error || !data) {
        Alert.alert("Couldn't connect", "Someone may have just joined that code.");
        return;
      }
      await setPair(data.id, data.code);
      router.replace("/sky");
      return;
    }

    setBusy(false);
    Alert.alert("That code is taken", "It already connects two other people - ask for a new one.");
  };

  if (!isHydrated || pairId) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (pendingCode) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16 }}>
        <Text style={{ fontSize: 18, textAlign: "center" }}>Share this code</Text>
        <Text style={{ fontSize: 40, fontWeight: "700", textAlign: "center", letterSpacing: 4 }}>
          {pendingCode}
        </Text>

        <Pressable
          onPress={async () => {
            await Clipboard.setStringAsync(pendingCode);
            Alert.alert("Copied");
          }}
          style={{ backgroundColor: "#457b9d", padding: 16, borderRadius: 12 }}
        >
          <Text style={{ color: "white", textAlign: "center" }}>Copy code</Text>
        </Pressable>

        <Pressable
          onPress={() => Share.share({ message: `Join me on Stellate: ${pendingCode}` })}
          style={{ backgroundColor: "#457b9d", padding: 16, borderRadius: 12 }}
        >
          <Text style={{ color: "white", textAlign: "center" }}>Send to someone</Text>
        </Pressable>

        <Pressable
          onPress={async () => {
            const { data } = await supabase.from("pairs").select("id").eq("code", pendingCode).single();
            if (data) {
              await setPair(data.id, pendingCode);
            }
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