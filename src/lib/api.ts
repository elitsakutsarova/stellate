import Constants from "expo-constants";

// In development, reuse the laptop's IP that Metro was reached on, so the API URL
// never needs updating when switching networks. EXPO_PUBLIC_API_URL is for real builds.
const SERVER_PORT = 3000;
const devHost = Constants.expoConfig?.hostUri?.split(":")[0];
const API_URL = __DEV__ && devHost ? `http://${devHost}:${SERVER_PORT}` : (process.env.EXPO_PUBLIC_API_URL as string);

type PairResponse = { id: string; code: string };

// status is undefined when the server couldn't be reached at all
export class ApiError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
        super(message);
        this.status = status;
    }
}

const request = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
    let res: Response;
    try {
        res = await fetch(`${API_URL}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    } catch {
        throw new ApiError("Couldn't reach the server. Check that it's running and your phone is on the same network.");
    }

    // not every error response is JSON
    let data: any = null;
    try {
        data = await res.json();
    } catch {
    }

    if (!res.ok) {
        throw new ApiError(data?.error ?? `Something went wrong (${res.status}). Please try again.`, res.status);
    }
    return data as T;
};

export const createPair = (deviceId: string) => request<PairResponse>("/api/pairs", { deviceId });

export const joinPair = (code: string, deviceId: string) =>
    request<PairResponse>("/api/pairs/join", { code, deviceId });

export type Coords = { latitude: number; longitude: number };
export type PairStatus = { id: string; code: string; partnerLeft: boolean; partnerLocation: Coords | null };

export const getPairStatus = (pairId: string, deviceId: string) =>
    request<PairStatus>(`/api/pairs/${pairId}/status`, { deviceId });

export const setLocation = (pairId: string, deviceId: string, coords: Coords) =>
    request<{ ok: true }>(`/api/pairs/${pairId}/location`, { deviceId, ...coords });

// null = the "looks up" toggle is off
export const setPushToken = (pairId: string, deviceId: string, token: string | null) =>
    request<{ ok: true }>(`/api/pairs/${pairId}/push-token`, { deviceId, token });

export const sendLookingNow = (pairId: string, deviceId: string, looking: "sun" | "moon") =>
    request<{ ok: true }>(`/api/pairs/${pairId}/looking`, { deviceId, looking });

export const setPresence = (pairId: string, deviceId: string, active: boolean) =>
    request<{ ok: true }>(`/api/pairs/${pairId}/presence`, { deviceId, active });
