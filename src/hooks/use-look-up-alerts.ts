import { useEffect } from "react";
import { sendLookingNow, setPushToken } from "@/lib/api";
import { getPushToken, notificationsSupported } from "@/lib/notifications";
import type { Looking } from "@/hooks/use-pair-presence";

// How long you have to keep looking before your special someone gets a push
// - so sweeping the phone past the moon doesn't count. (The server then
// stays quiet for 30 minutes before it'll send them another one.)
const LOOKING_FOR_MS = 5000;

type Options = {
    enabled: boolean;          // my toggle: do *I* want these pushes?
    pairId: string | null;
    deviceId: string | null;
    myLooking: Looking;        // what I'm looking at right now
    partnerOnline: boolean;    // they're in the app - they'll see it anyway
};

// Both halves of "your special someone looks up":
// - receiving: with the toggle on, give the server this phone's push token;
//   with it off, give it "none" - so the server has nowhere to send to.
// - sending: after looking for LOOKING_FOR_MS while they're not in the app,
//   tell the server; it decides (their toggle, the 30 min pause) whether a
//   push actually goes out.
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
        // cleared (and restarted) as soon as what you're looking at changes
        const timer = setTimeout(() => {
            sendLookingNow(pairId, deviceId, myLooking).catch(() => {});
        }, LOOKING_FOR_MS);
        return () => clearTimeout(timer);
    }, [myLooking, partnerOnline, pairId, deviceId]);
}
