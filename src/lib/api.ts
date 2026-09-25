const API_URL = process.env.EXPO_PUBLIC_API_URL as string;

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
