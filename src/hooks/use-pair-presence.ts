import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useRouter } from "expo-router";
import { Alert } from "react-native";
import * as Crypto from "expo-crypto";
import { supabase } from "@/lib/supabase";
import { getPairStatus, ApiError, type PairStatus } from "@/lib/api";
import { pairChannel, PAIR_CHANGED_EVENT } from "@/lib/constants";
import { usePairStore } from "@/store/use-pair-store";

const RETRY_MS = 5000;
// how long "looking" must stay the same before we tell the other phone —
// stops the status flickering when the sun/moon sits right at the screen edge
const LOOKING_DELAY_MS = 1000;

export type Looking = "sun" | "moon" | null;
type PresencePayload = { online: boolean; looking: Looking };

// Loads the current pair (through our server — the anon key can't read the
// pairs table at all) and keeps it live over one Supabase Realtime channel:
// - presence: is my partner in the app right now, and what are they looking at?
// - "pair-changed" broadcasts from the server: re-fetch status (e.g. partner
//   left or came back)
// Only ever used on the sky screen, so this stays a plain hook rather than
// shared/global state.
export function usePairPresence(isHydrated: boolean, deviceId: string | null, pairId: string | null) {
    const router = useRouter();
    const [pair, setPair] = useState<PairStatus | null>(null);
    const [partnerOnline, setPartnerOnline] = useState(false);
    const [partnerLooking, setPartnerLooking] = useState<Looking>(null);
    const [offline, setOffline] = useState(false); // server unreachable, retrying
    const clearPair = usePairStore((state) => state.clearPair);

    // Refs, not state: setLooking (below) lives outside the effect but needs
    // the effect's current channel, and changing them shouldn't re-render.
    const channelRef = useRef<RealtimeChannel | null>(null);
    const lookingRef = useRef<Looking>(null); // what we last told the other phone
    const lookingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => {
        if (!isHydrated) return;
        if (!deviceId || !pairId) { router.replace("/"); return; }

        let cancelled = false;
        // A random key per session, not deviceId — presence keys are visible
        // to everyone on the channel, and deviceId works like a password on
        // the server, so the partner should never see it.
        const presenceKey = Crypto.randomUUID();

        let retryTimer: ReturnType<typeof setTimeout> | undefined;

        const refresh = async () => {
            clearTimeout(retryTimer);
            try {
                const status = await getPairStatus(pairId, deviceId);
                // the component isn't around anymore (e.g. React's dev-mode
                // mount/unmount/remount check, or a real navigation elsewhere)
                // — don't act on stale data, and definitely don't navigate
                // anywhere on its behalf
                if (cancelled) return;
                setPair(status);
                setOffline(false);
            } catch (err: any) {
                if (cancelled) return;
                if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
                    // The server says this pair is really gone (or was never
                    // ours). Forget it before going home — otherwise the home
                    // screen sees the saved pair and sends us straight back here.
                    await clearPair();
                    Alert.alert("Couldn't load your connection", err.message);
                    router.replace("/");
                    return;
                }
                // No connection / server down / rate limited: it's temporary,
                // so stay here and keep trying instead of leaving the screen.
                setOffline(true);
                retryTimer = setTimeout(refresh, RETRY_MS);
            }
        };

        const channel = supabase.channel(pairChannel(pairId), {
            config: { presence: { key: presenceKey } },
        });
        channelRef.current = channel;
        channel
            .on("broadcast", { event: PAIR_CHANGED_EVENT }, refresh)
            .on("presence", { event: "sync" }, () => {
                const state = channel.presenceState<PresencePayload>();
                const others = Object.keys(state).filter((k) => k !== presenceKey);
                setPartnerOnline(others.length > 0);
                // each key holds a list of payloads (one per open connection);
                // the last one is the most recent
                const latest = others.length > 0 ? state[others[0]].at(-1) : undefined;
                setPartnerLooking(latest?.looking ?? null);
            })
            .subscribe(async (status) => {
                // Realtime reconnects by itself; this just shows the "retrying"
                // message meanwhile. SUBSCRIBED below clears it via refresh().
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                    if (!cancelled) setOffline(true);
                    return;
                }
                if (status !== "SUBSCRIBED") return;
                // lookingRef, not null: after a reconnect, re-send what we're
                // actually looking at right now
                await channel.track({ online: true, looking: lookingRef.current });
                // fetch only once we're listening, so a change that happens in
                // between can't slip past unnoticed
                refresh();
            });

        return () => {
            cancelled = true;
            clearTimeout(retryTimer);
            clearTimeout(lookingTimer.current);
            channelRef.current = null;
            supabase.removeChannel(channel);
        };
    }, [isHydrated, deviceId, pairId, clearPair]);

    // Called by the viewfinder whenever the sun/moon enters or leaves the
    // screen. Waits LOOKING_DELAY_MS first; if it changes again meanwhile,
    // the timer restarts, so only a settled value is ever sent.
    const setLooking = useCallback((looking: Looking) => {
        clearTimeout(lookingTimer.current);
        lookingTimer.current = setTimeout(() => {
            if (looking === lookingRef.current) return; // nothing new to tell
            lookingRef.current = looking;
            channelRef.current?.track({ online: true, looking });
        }, LOOKING_DELAY_MS);
    }, []);

    return {
        pair,
        partnerOnline,
        partnerLooking,
        partnerLeft: pair?.partnerLeft ?? false,
        offline,
        setLooking,
    };
}
