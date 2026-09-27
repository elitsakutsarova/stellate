import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { Coords } from "@/lib/api";
import { roughly } from "@/lib/geo";
import { updateSkyWidget } from "@/widget/widget";
import type { WidgetData } from "@/widget/sky-widget";

// Keeps the home screen widget up to date while the sky screen is open: on a new rough
// location (yours or theirs), on every new minute of time together, and whenever the app
// comes back to the front (e.g. right after adding the widget).
export function useWidgetSync(me: Coords | null, them: Coords | null, secondsTogether: number) {
    const myLat = me && roughly(me.latitude), myLon = me && roughly(me.longitude);
    const theirLat = them && roughly(them.latitude), theirLon = them && roughly(them.longitude);
    const minutes = Math.floor(secondsTogether / 60);

    // null until located - until then the widget keeps what it shows
    const data: WidgetData | null = myLat === null || myLon === null ? null : {
        paired: true,
        me: { latitude: myLat, longitude: myLon },
        them: theirLat !== null && theirLon !== null ? { latitude: theirLat, longitude: theirLon } : null,
        secondsTogether: minutes * 60,
    };

    const latest = useRef(data);
    useEffect(() => {
        latest.current = data;
        if (data) updateSkyWidget(data);
    }, [myLat, myLon, theirLat, theirLon, minutes]);

    useEffect(() => {
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active" && latest.current) updateSkyWidget(latest.current);
        });
        return () => subscription.remove();
    }, []);

    return data;
}
