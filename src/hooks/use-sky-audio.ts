import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { setAudioModeAsync, useAudioPlayer, useAudioPlaylist, type AudioPlayer } from "expo-audio";
import { usePairStore } from "@/store/use-pair-store";
import { playShortChime } from "@/lib/sounds";

const SONGS = [
    require("@/assets/audio/song1.mp3"),
    require("@/assets/audio/song2.mp3"),
    require("@/assets/audio/song3.mp3"),
];
const MUSIC_VOLUME = 0.35;
const MUSIC_TOGETHER_VOLUME = 0.15; // softer, so the together chime is heard
const FADE_MS = 1500;
const FADE_STEP_MS = 50;

// Moves the volume to `to` in small steps, then calls `then`. Returns a stop function.
function fadeVolume(player: { volume: number }, to: number, then?: () => void) {
    const from = player.volume;
    const steps = FADE_MS / FADE_STEP_MS;
    let step = 0;
    const timer = setInterval(() => {
        step += 1;
        try {
            player.volume = from + (to - from) * Math.min(1, step / steps);
        } catch {
            clearInterval(timer); // the player was released (screen left mid-fade)
            return;
        }
        if (step >= steps) {
            clearInterval(timer);
            then?.();
        }
    }, FADE_STEP_MS);
    return () => clearInterval(timer);
}

const replay = (player: AudioPlayer) => {
    player.seekTo(0).catch(() => {});
    player.play();
};

// Music and chimes on the sky screen. The toggles live in the store.
export function useSkyAudio({ together, partnerOnline }: { together: boolean; partnerOnline: boolean }) {
    const { music, chimes } = usePairStore((state) => state.sound);
    const playlist = useAudioPlaylist({ sources: SONGS, loop: "all" });
    const arrivalChime = useAudioPlayer(require("@/assets/audio/multiple-chime.m4a"));
    const togetherChime = useAudioPlayer(require("@/assets/audio/long-chime.m4a"));
    const [inFront, setInFront] = useState(AppState.currentState === "active");

    useEffect(() => {
        // follows the silent switch, and plays along with other apps instead of stopping them
        setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers", shouldPlayInBackground: false })
            .catch(() => {});
        playlist.volume = 0;
        playlist.skipTo(Math.floor(Math.random() * SONGS.length));
        const subscription = AppState.addEventListener("change", (state) => setInFront(state === "active"));
        return () => subscription.remove();
    }, [playlist]);

    useEffect(() => {
        if (!music || !inFront) {
            playlist.pause();
            return;
        }
        playlist.play();
        return fadeVolume(playlist, together ? MUSIC_TOGETHER_VOLUME : MUSIC_VOLUME);
    }, [music, inFront, together, playlist]);

    useEffect(() => {
        if (partnerOnline && chimes) replay(arrivalChime);
    }, [partnerOnline, chimes, arrivalChime]);

    useEffect(() => {
        if (!together || !chimes) return;
        togetherChime.volume = 1;
        replay(togetherChime);
        return () => {
            fadeVolume(togetherChime, 0, () => togetherChime.pause());
        };
    }, [together, chimes, togetherChime]);

    return { chimeFound: () => playShortChime() };
}
