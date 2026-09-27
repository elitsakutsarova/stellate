import { useEffect } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { usePairStore } from "@/store/use-pair-store";
import { LaunchScreen, useLaunch } from "@/components/launch-screen";
import { COLORS, FONT_FILES } from "@/lib/theme";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const hydrate = usePairStore((state) => state.hydrate);
  const isHydrated = usePairStore((state) => state.isHydrated);
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  const launchDone = useLaunch((state) => state.done);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const ready = isHydrated && (fontsLoaded || !!fontError);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.night }}>
      <StatusBar style="light" />
      {ready && (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.night }, animation: "fade" }} />
      )}
      {!launchDone && <LaunchScreen ready={ready} />}
    </View>
  );
}
