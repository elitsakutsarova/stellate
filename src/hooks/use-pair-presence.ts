import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Alert } from "react-native";
import { supabase } from "@/lib/supabase";

// Loads the current pair row and keeps it (and who's online/left) in sync
// via Supabase Realtime — the "am I actually still in a valid connection,
// and is my partner here" concern for the sky screen. Only ever used there,
// so this stays a plain hook rather than shared/global state.
export function usePairPresence(isHydrated: boolean, deviceId: string | null, pairId: string | null) {
    const router = useRouter();
    const [pair, setPair] = useState<any>(null);
    const [partnerOnline, setPartnerOnline] = useState(false);
    const [partnerLeft, setPartnerLeft] = useState(false);

    useEffect(() => {
        if (!isHydrated) return;
        if (!deviceId || !pairId) { router.replace("/"); return; }

        let rowChannel: any;
        let presenceChannel: any;
        let cancelled = false;

        (async () => {
            const { data } = await supabase.from("pairs").select("*").eq("id", pairId).single();
            // the component isn't around anymore (e.g. React's dev-mode
            // mount/unmount/remount check, or a real navigation elsewhere)
            // — don't act on stale data, and definitely don't navigate
            // anywhere on its behalf
            if (cancelled) return;
            if (!data) {
                Alert.alert("Couldn't load your connection", "Please try reconnecting with your code.");
                router.replace("/");
                return;
            }
            setPair(data);

            const amI_A = data.device_a === deviceId;
            setPartnerLeft(!(amI_A ? data.device_b_active : data.device_a_active));

            rowChannel = supabase
                .channel(`pair-row-${pairId}`)
                .on(
                    "postgres_changes",
                    { event: "UPDATE", schema: "public", table: "pairs", filter: `id=eq.${pairId}` },
                    (payload) => {
                        const updated = payload.new as any;
                        setPartnerLeft(!(amI_A ? updated.device_b_active : updated.device_a_active));
                    }
                )
                .subscribe();

            presenceChannel = supabase.channel(`pair-presence-${pairId}`, {
                config: { presence: { key: deviceId } },
            });
            presenceChannel
                .on("presence", { event: "sync" }, () => {
                    const state = presenceChannel.presenceState();
                    const others = Object.keys(state).filter((k: string) => k !== deviceId);
                    setPartnerOnline(others.length > 0);
                })
                .subscribe(async (status: string) => {
                    if (status === "SUBSCRIBED") await presenceChannel.track({ online: true });
                });
        })();

        return () => {
            cancelled = true;
            if (rowChannel) supabase.removeChannel(rowChannel);
            if (presenceChannel) supabase.removeChannel(presenceChannel);
        };
    }, [isHydrated, deviceId, pairId]);

    return { pair, partnerOnline, partnerLeft };
}
