import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { usePairStore } from "@/store/use-pair-store";

const TAP_VOLUME = 0.4;

let shortChime: AudioPlayer | null = null; // made on first use, then kept for the whole app

// The short chime: full for finding the sun/moon, softer for taps. Off with the Chimes switch.
export function playShortChime(volume = 1) {
    if (!usePairStore.getState().sound.chimes) return;
    shortChime ??= createAudioPlayer(require("@/assets/audio/short-chime.m4a"));
    shortChime.volume = volume;
    shortChime.seekTo(0).catch(() => {});
    shortChime.play();
}

export const playTap = () => playShortChime(TAP_VOLUME);
