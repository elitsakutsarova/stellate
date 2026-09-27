import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Alert, AppState } from "react-native";
import * as Crypto from "expo-crypto";
import { closeOldPairChannel, supabase } from "@/lib/supabase";
import { getPairStatus, ApiError, type PairStatus } from "@/lib/api";
import { pairChannel, PAIR_CHANGED_EVENT } from "@/lib/constants";
import { usePairStore } from "@/store/use-pair-store";

const RETRY_MS = 5000;
// how long "looking" must stay the same before it's sent (stops flicker at the screen edge)
const LOOKING_DELAY_MS = 1000;

export type Looking = "sun" | "moon" | null;
type PresencePayload = { online: boolean; looking: Looking };

// Loads the pair through the server (the app can't read the table directly) and
// keeps it live over one Realtime channel: presence (online + looking) and the
// server's "pair-changed" broadcasts.
export function usePairPresence(deviceId: string | null, pairId: string | null) {
    const [pair, setPair] = useState<PairStatus | null>(null);
    const [partnerOnline, setPartnerOnline] = useState(false);
    const [partnerLooking, setPartnerLooking] = useState<Looking>(null);
    const [offline, setOffline] = useState(false); // server unreachable, retrying
    const clearPair = usePairStore((state) => state.clearPair);

    const channelRef = useRef<RealtimeChannel | null>(null);
    const lookingRef = useRef<Looking>(null); // what we last told the other phone
    const lookingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => {
        if (!deviceId || !pairId) return;

        let cancelled = false;
        // a random key, not deviceId: presence keys are visible to the other phone, and
        // deviceId works like a password on the server
        const presenceKey = Crypto.randomUUID();

        let retryTimer: ReturnType<typeof setTimeout> | undefined;

        const refresh = async () => {
            clearTimeout(retryTimer);
            try {
                const status = await getPairStatus(pairId, deviceId);
                // unmounted meanwhile - don't act on stale data
                if (cancelled) return;
                setPair(status);
                setOffline(false);
            } catch (err: any) {
                if (cancelled) return;
                if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
                    // the pair is gone - forgetting it sends the sky screen back home
                    await clearPair();
                    Alert.alert("Couldn't load your connection", err.message);
                    return;
                }
                // temporary (no connection, server down) - keep retrying here
                setOffline(true);
                retryTimer = setTimeout(refresh, RETRY_MS);
            }
        };

        let channel: RealtimeChannel | undefined;
        closeOldPairChannel(pairId).then(() => {
            if (cancelled) return;
            const ch = supabase.channel(pairChannel(pairId), {
                config: { presence: { key: presenceKey } },
            });
            channel = ch;
            channelRef.current = ch;
            ch
                .on("broadcast", { event: PAIR_CHANGED_EVENT }, refresh)
                .on("presence", { event: "sync" }, () => {
                    const state = ch.presenceState<PresencePayload>();
                    const others = Object.keys(state).filter((k) => k !== presenceKey);
                    setPartnerOnline(others.length > 0);
                    // each key holds one payload per connection; the last is the newest
                    const latest = others.length > 0 ? state[others[0]].at(-1) : undefined;
                    setPartnerLooking(latest?.looking ?? null);
                })
                .subscribe(async (status) => {
                    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                        if (!cancelled) setOffline(true);
                        return;
                    }
                    if (status !== "SUBSCRIBED") return;
                    // re-send what we're looking at (e.g. after a reconnect)
                    await ch.track({ online: true, looking: lookingRef.current });
                    // fetch only once subscribed, so no change can slip through in between
                    refresh();
                });
        });

        // Leave presence when the app goes to the background (the connection can stay
        // open for a while). Not on "inactive" - iOS uses that for popups too.
        const appState = AppState.addEventListener("change", (state) => {
            if (state === "background") {
                channel?.untrack().catch(() => {});
            } else if (state === "active") {
                channel?.track({ online: true, looking: lookingRef.current }).catch(() => {});
                refresh(); // catch up on anything that changed while away
            }
        });

        return () => {
            cancelled = true;
            clearTimeout(retryTimer);
            clearTimeout(lookingTimer.current);
            appState.remove();
            channelRef.current = null;
            if (channel) supabase.removeChannel(channel);
        };
    }, [deviceId, pairId, clearPair]);

    // Only sends a value that stays the same for LOOKING_DELAY_MS.
    const setLooking = (looking: Looking) => {
        clearTimeout(lookingTimer.current);
        lookingTimer.current = setTimeout(() => {
            if (looking === lookingRef.current) return; // nothing new to tell
            lookingRef.current = looking;
            channelRef.current?.track({ online: true, looking });
        }, LOOKING_DELAY_MS);
    };

    return {
        pair,
        partnerOnline,
        partnerLooking,
        partnerLeft: pair?.partnerLeft ?? false,
        offline,
        setLooking,
    };
}
