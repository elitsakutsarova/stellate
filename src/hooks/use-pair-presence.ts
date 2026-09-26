import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Alert } from "react-native";
import * as Crypto from "expo-crypto";
import { supabase } from "@/lib/supabase";
import { getPairStatus, type PairStatus } from "@/lib/api";
import { pairChannel, PAIR_CHANGED_EVENT } from "@/lib/constants";

// Loads the current pair (through our server — the anon key can't read the
// pairs table at all) and keeps it live over one Supabase Realtime channel:
// - presence: is my partner in the app right now?
// - "pair-changed" broadcasts from the server: re-fetch status (e.g. partner
//   left or came back)
// Only ever used on the sky screen, so this stays a plain hook rather than
// shared/global state.
export function usePairPresence(isHydrated: boolean, deviceId: string | null, pairId: string | null) {
    const router = useRouter();
    const [pair, setPair] = useState<PairStatus | null>(null);
    const [partnerOnline, setPartnerOnline] = useState(false);

    useEffect(() => {
        if (!isHydrated) return;
        if (!deviceId || !pairId) { router.replace("/"); return; }

        let cancelled = false;
        // A random key per session, not deviceId — presence keys are visible
        // to everyone on the channel, and deviceId works like a password on
        // the server, so the partner should never see it.
        const presenceKey = Crypto.randomUUID();

        const refresh = async () => {
            try {
                const status = await getPairStatus(pairId, deviceId);
                // the component isn't around anymore (e.g. React's dev-mode
                // mount/unmount/remount check, or a real navigation elsewhere)
                // — don't act on stale data, and definitely don't navigate
                // anywhere on its behalf
                if (!cancelled) setPair(status);
            } catch (err: any) {
                if (cancelled) return;
                Alert.alert("Couldn't load your connection", err.message);
                router.replace("/");
            }
        };

        const channel = supabase.channel(pairChannel(pairId), {
            config: { presence: { key: presenceKey } },
        });
        channel
            .on("broadcast", { event: PAIR_CHANGED_EVENT }, refresh)
            .on("presence", { event: "sync" }, () => {
                const others = Object.keys(channel.presenceState()).filter((k) => k !== presenceKey);
                setPartnerOnline(others.length > 0);
            })
            .subscribe(async (status) => {
                if (status !== "SUBSCRIBED") return;
                await channel.track({ online: true });
                // fetch only once we're listening, so a change that happens in
                // between can't slip past unnoticed
                refresh();
            });

        return () => {
            cancelled = true;
            supabase.removeChannel(channel);
        };
    }, [isHydrated, deviceId, pairId]);

    return { pair, partnerOnline, partnerLeft: pair?.partnerLeft ?? false };
}
