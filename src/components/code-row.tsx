import { useState } from "react";
import { Pressable, Share, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { CopyIcon, ShareIcon } from "@/components/art";
import { glass } from "@/components/ui";
import { COLORS, FONTS, RADIUS } from "@/lib/theme";

export function CodeRow({ code, size = 26, accent = COLORS.accent }: { code: string; size?: number; accent?: string }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await Clipboard.setStringAsync(code);
        } catch {
            return; // nothing copied, so don't say it was
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    const height = size * 2.3;

    return (
        <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable
                onPress={copy}
                accessibilityLabel="Copy code"
                style={[glass, { flex: 1, minHeight: height, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
            >
                <Text style={{ fontFamily: FONTS.medium, fontSize: size, letterSpacing: size / 4.5, color: COLORS.text }}>{code}</Text>
                {copied
                    ? <Text style={{ fontFamily: FONTS.regular, fontSize: 13, color: COLORS.online }}>Copied</Text>
                    : <CopyIcon color={COLORS.text} />}
            </Pressable>
            <Pressable
                onPress={() => Share.share({ message: `Join me on Stellate: ${code}` }).catch(() => {})}
                accessibilityLabel="Share code"
                style={({ pressed }) => ({
                    width: height, borderRadius: RADIUS, backgroundColor: accent,
                    alignItems: "center", justifyContent: "center", opacity: pressed ? 0.75 : 1,
                })}
            >
                <ShareIcon color={COLORS.onAccent} />
            </Pressable>
        </View>
    );
}
