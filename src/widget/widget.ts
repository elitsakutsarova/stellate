import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { requestWidgetUpdate, type WidgetTaskHandler } from "react-native-android-widget";
import { WIDGET_DATA_KEY } from "@/lib/constants";
import { renderSkyWidget, type WidgetData } from "@/widget/sky-widget";

export const WIDGET_NAME = "Sky"; // must match app.json

const EMPTY: WidgetData = { paired: false, me: null, them: null, secondsTogether: 0 };

async function loadWidgetData(): Promise<WidgetData> {
    try {
        const saved = await AsyncStorage.getItem(WIDGET_DATA_KEY);
        return saved ? { ...EMPTY, ...JSON.parse(saved) } : EMPTY;
    } catch {
        return EMPTY;
    }
}

// Saves what the widget shows and redraws it straight away (called by the app).
export async function updateSkyWidget(data: WidgetData) {
    if (Platform.OS !== "android") return;
    try {
        await AsyncStorage.setItem(WIDGET_DATA_KEY, JSON.stringify(data));
        await requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => renderSkyWidget(data) });
    } catch (err) {
        console.warn("Couldn't update the widget:", err);
    }
}

// Android runs this when the widget is added, resized, or every 30 minutes - even with
// the app closed - so the sun and moon are worked out again from the saved data.
export const widgetTaskHandler: WidgetTaskHandler = async ({ widgetAction, renderWidget }) => {
    if (widgetAction === "WIDGET_DELETED" || widgetAction === "WIDGET_CLICK") return;
    renderWidget(renderSkyWidget(await loadWidgetData()));
};
