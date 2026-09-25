import { useEffect } from "react";
import { Stack } from "expo-router";
import { usePairStore } from "@/store/use-pair-store";

export default function RootLayout() {
  const hydrate = usePairStore((state) => state.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return <Stack />;
}
