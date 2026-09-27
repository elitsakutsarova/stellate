import { useEffect, useState, useCallback } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";

// Asks for permission on first mount; after that, returning to the app only checks
// (no popup), and only "Try again" asks again.

// Module-level so a second, overlapping request (React's dev-mode double mount)
// shares the first one's result instead of showing another popup.
let pendingPermissionRequest: ReturnType<typeof Location.requestForegroundPermissionsAsync> | null = null;

export function useLocation() {
    const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    // once denied, the OS won't show the prompt again - only Settings can fix it
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
                // clear the error straight away - getting a position can take a while
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

    const checkStatus = useCallback(async () => {
        const { status, canAskAgain: canAsk } = await Location.getForegroundPermissionsAsync();
        await handlePermissionResult(status, canAsk);
    }, [handlePermissionResult]);

    // the only place that shows the system popup
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

    // notice when permission was changed in Settings
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
