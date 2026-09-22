import { useEffect, useState } from "react";
import * as Location from "expo-location";

// this has the premission ask and then if granted gets coords

export function useLocation() {
    const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== "granted") {
                setError("Location permission is needed to find the sun and moon in your sky.");
                return;
            }
            const pos = await Location.getCurrentPositionAsync({});
            setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        })();
    }, []);

    return { coords, error };
}