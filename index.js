import "expo-router/entry";
import { Platform } from "react-native";
import { registerWidgetTaskHandler } from "react-native-android-widget";
import { widgetTaskHandler } from "./src/widget/widget";

// lets Android draw the home screen widget, even when the app isn't open
if (Platform.OS === "android") registerWidgetTaskHandler(widgetTaskHandler);
