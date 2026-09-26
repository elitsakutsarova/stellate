import Constants from "expo-constants";

// In development, the phone already knows your laptop's LAN IP — it's how
// it found the Metro bundler in the first place (Constants.expoConfig.hostUri
// looks like "192.168.1.5:8081"). Reusing that IP (with the server's own
// port swapped in) means EXPO_PUBLIC_API_URL never has to be hand-updated
// every time you switch networks — it's only a fallback for a real build,
// where there's no Metro dev server to read this from and it needs a real
// deployed URL from .env instead.
const SERVER_PORT = 3000;
const devHost = Constants.expoConfig?.hostUri?.split(":")[0];
const API_URL = __DEV__ && devHost ? `http://${devHost}:${SERVER_PORT}` : (process.env.EXPO_PUBLIC_API_URL as string);

type PairResponse = { id: string; code: string };

const request = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
    let res: Response;
    try {
        res = await fetch(`${API_URL}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    } catch {
        // fetch itself failed — server unreachable, wifi off, wrong LAN IP, etc.
        throw new Error("Couldn't reach the server. Check that it's running and your phone is on the same network.");
    }

    // the server doesn't always respond with JSON — e.g. a 404 for a route
    // that doesn't exist comes back as plain text — so don't assume it does
    let data: any = null;
    try {
        data = await res.json();
    } catch {
        // leave data as null; the fallback message below covers this
    }

    if (!res.ok) {
        throw new Error(data?.error ?? `Something went wrong (${res.status}). Please try again.`);
    }
    return data as T;
};

export const createPair = (deviceId: string) => request<PairResponse>("/api/pairs", { deviceId });

export const joinPair = (code: string, deviceId: string) =>
    request<PairResponse>("/api/pairs/join", { code, deviceId });

export const setPresence = (pairId: string, deviceId: string, active: boolean) =>
    request<{ ok: true }>(`/api/pairs/${pairId}/presence`, { deviceId, active });
