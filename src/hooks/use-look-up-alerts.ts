import { useEffect } from "react";
import { sendLookingNow, setPushToken } from "@/lib/api";
import { getPushToken, notificationsSupported } from "@/lib/notifications";
import type { Looking } from "@/hooks/use-pair-presence";

// look this long before your special someone gets a push (the server then waits 30 min)
const LOOKING_FOR_MS = 5000;

type Options = {
    enabled: boolean;          // my toggle: do *I* want these pushes?
    pairId: string | null;
    deviceId: string | null;
    myLooking: Looking;        // what I'm looking at right now
    partnerOnline: boolean;    // they're in the app - they'll see it anyway
};

// Receiving: with the toggle off, the server gets no push token, so it can't send.
// Sending: after looking for a while, tell the server; it decides whether to push.
export function useLookUpAlerts({ enabled, pairId, deviceId, myLooking, partnerOnline }: Options) {
    useEffect(() => {
        if (!pairId || !deviceId || !notificationsSupported) return;
        let cancelled = false;
        (async () => {
            const token = enabled ? await getPushToken() : null;
            if (!cancelled) setPushToken(pairId, deviceId, token).catch(() => {});
        })();
        return () => {
            cancelled = true;
        };
    }, [enabled, pairId, deviceId]);

    useEffect(() => {
        if (!myLooking || partnerOnline || !pairId || !deviceId) return;
        const timer = setTimeout(() => {
            sendLookingNow(pairId, deviceId, myLooking).catch(() => {});
        }, LOOKING_FOR_MS);
        return () => clearTimeout(timer);
    }, [myLooking, partnerOnline, pairId, deviceId]);
}
