import { useState } from "react";
import { Pressable, View } from "react-native";
import { Pill } from "@/components/ui";

export type DebugItem = { label: string; onPress: () => void };

// Development-only tools, tucked behind one small button so they don't cover the sky.
export function DebugMenu({ items, top }: { items: DebugItem[]; top: number }) {
    const [open, setOpen] = useState(false);
    if (!__DEV__) return null;
    return (
        <View pointerEvents="box-none" style={{ position: "absolute", top, right: 12, alignItems: "flex-end", gap: 8, zIndex: 3 }}>
            <Pressable onPress={() => setOpen(!open)} hitSlop={8} accessibilityLabel={open ? "Close debug tools" : "Open debug tools"}>
                <Pill>{open ? "Close" : "Debug"}</Pill>
            </Pressable>
            {open && items.map((item, i) => (
                <Pressable key={i} onPress={item.onPress}>
                    <Pill>{item.label}</Pill>
                </Pressable>
            ))}
        </View>
    );
}
