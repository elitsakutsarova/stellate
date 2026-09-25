import { useEffect, useState, useCallback } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";

// The system permission dialog is requested directly on first mount — the
// standard "just ask when needed" flow. Our own message + "Try again" is
// specifically the *retry* affordance for after a decline, not a priming
// screen shown before that first ask. Returning to the foreground (e.g.
// after toggling permission in Settings) only ever *checks* the status via
// getForegroundPermissionsAsync, which shows no UI — so backgrounding and
// re-opening the app doesn't spam the system dialog on its own; only a
// mount or an explicit "Try again" tap does that.

// Deliberately module-level, not a ref or state: React's dev-mode
// mount/unmount/remount check fully tears down and recreates this hook's
// instance (confirmed earlier with the sky.tsx mount-loop bug), so a ref
// or piece of state would reset with it and never see the first
// instance's still-pending request. This holds the actual in-flight
// promise (not just a boolean) so a second, overlapping call *shares* the
// same real result instead of being dropped — a plain "already in
// progress, skip" flag stopped the duplicate dialog, but silently lost
// the result for whichever instance survived, since the other instance
// (the one that actually got the result) had already been unmounted by
// the time it resolved.
let pendingPermissionRequest: ReturnType<typeof Location.requestForegroundPermissionsAsync> | null = null;

export function useLocation() {
    const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Once permission is denied, re-requesting it doesn't re-show the
    // system prompt on iOS or Android — it just immediately returns
    // "denied" again. canAskAgain tells us when that's happened, so we can
    // point the user at Settings instead of offering a "Try again" that
    // can never actually work.
    const [canAskAgain, setCanAskAgain] = useState(true);

    const loadPosition = useCallback(async () => {
        try {
            const lastKnown = await Location.getLastKnownPositionAsync();
            if (lastKnown) {
                setCoords({ latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude });
            }

            const pos = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
            });
            setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        } catch (err) {
            console.warn("Location error:", err);
            setError("Couldn't get your exact location. Please try again.");
        }
    }, []);

    const handlePermissionResult = useCallback(
        async (status: string, canAsk: boolean) => {
            setCanAskAgain(canAsk);
            if (status === "granted") {
                // Clear the error as soon as permission is confirmed — don't
                // wait on the position fetch, which can be slow (waiting on
                // a GPS/network fix), or the old message lingers on screen.
                setError(null);
                await loadPosition();
            } else {
                setError(
                    canAsk
                        ? "Location permission is needed to find the sun and moon in your sky."
                        : "Location access is off for Stellate. Turn it on in Settings to find the sun and moon in your sky."
                );
            }
        },
        [loadPosition]
    );

    // Checks the current status without showing any system UI — safe to
    // call as often as needed.
    const checkStatus = useCallback(async () => {
        const { status, canAskAgain: canAsk } = await Location.getForegroundPermissionsAsync();
        await handlePermissionResult(status, canAsk);
    }, [handlePermissionResult]);

    // The only place that shows the real system permission dialog. If a
    // request is already in flight (e.g. from a dev-mode double-mount),
    // this awaits that same promise instead of starting a second one —
    // so every caller gets the real result, not just whichever instance
    // happened to start it first.
    const requestPermission = useCallback(async () => {
        if (!pendingPermissionRequest) {
            pendingPermissionRequest = Location.requestForegroundPermissionsAsync().finally(() => {
                pendingPermissionRequest = null;
            });
        }
        const { status, canAskAgain: canAsk } = await pendingPermissionRequest;
        await handlePermissionResult(status, canAsk);
    }, [handlePermissionResult]);

    useEffect(() => {
        requestPermission();
    }, [requestPermission]);

    // Returning from Settings (after toggling permission there) doesn't
    // trigger anything on its own — re-check whenever the app comes back
    // to the foreground, so granting access there is actually noticed
    // without needing to force-close and reopen the app. This is a check,
    // not a request, so it still won't show the system dialog on its own.
    useEffect(() => {
        const subscription = AppState.addEventListener("change", (nextState) => {
            if (nextState === "active") {
                checkStatus();
            }
        });
        return () => subscription.remove();
    }, [checkStatus]);

    return { coords, error, canAskAgain, retry: requestPermission };
}
