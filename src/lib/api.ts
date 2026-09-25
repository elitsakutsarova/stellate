const API_URL = process.env.EXPO_PUBLIC_API_URL as string;

type PairResponse = { id: string; code: string };

const request = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
    const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data?.error ?? "Something went wrong");
    }
    return data as T;
};

export const createPair = (deviceId: string) => request<PairResponse>("/api/pairs", { deviceId });

export const joinPair = (code: string, deviceId: string) =>
    request<PairResponse>("/api/pairs/join", { code, deviceId });

export const setPresence = (pairId: string, deviceId: string, active: boolean) =>
    request<{ ok: true }>(`/api/pairs/${pairId}/presence`, { deviceId, active });
