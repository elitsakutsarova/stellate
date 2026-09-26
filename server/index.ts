import path from "node:path";
import { randomInt } from "node:crypto";
import dotenv from "dotenv";

// resolve relative to this file, not the current working directory, so
// `npm run server` works the same regardless of where it's run from
dotenv.config({ path: path.join(__dirname, ".env") });

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import { CHANNELS, pairChannel, PAIR_CHANGED_EVENT } from "../src/lib/constants";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY - copy server/.env.example to server/.env and fill them in."
    );
}

// The service role key bypasses Row Level Security entirely. That's safe
// here specifically because this client only ever runs on the server -
// it's never bundled into the app, so nobody outside this process can use
// it. All the "who's allowed to do what" checks this route file performs
// take the place of RLS for these operations.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// A generous baseline for every route, so a single client/script can't
// hammer the API unbounded - most abuse of any kind gets caught here.
app.use(
    "/api",
    rateLimit({
        windowMs: 60 * 1000,
        limit: 60,
        standardHeaders: true,
        legacyHeaders: false,
    })
);

// Much stricter on join specifically - this is the endpoint someone would
// use to brute-force-guess a code. 1.29 billion possible codes only
// resists guessing if the guess *rate* is also bounded; this caps it at
// 10/minute per IP, which makes sustained guessing impractical without
// controlling a large number of different source IPs.
const joinLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Please wait a moment and try again." },
});

app.get("/", (_req, res) => {
    res.json({ ok: true });
});

// Unclaimed codes older than this are treated as expired - bounds how
// long a code stays guessable if nobody ever joins it, rather than
// leaving it valid (and brute-forceable) forever.
const PAIR_EXPIRATION_MS = 24 * 60 * 60 * 1000;
const isExpired = (createdAt: string) => Date.now() - new Date(createdAt).getTime() > PAIR_EXPIRATION_MS;

const generateCode = () => {
    // no confusing characters like 0/O or 1/I - matches the app's old client-side generator.
    // randomInt (not Math.random) because the code acts as a secret: Math.random
    // is only meant to *look* random, not to be unpredictable to an attacker.
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 6 }, () => chars[randomInt(chars.length)]).join("");
};

// Tells both phones "this pair changed, ask the server for the new status".
// Deliberately carries no data - the app re-fetches through /status, which
// does the membership check, so nothing sensitive ever goes over the channel.
// Best-effort: a failed announcement shouldn't fail the request that caused it.
const announcePairChanged = async (pairId: string) => {
    const channel = supabase.channel(pairChannel(pairId));
    try {
        const result = await channel.httpSend(PAIR_CHANGED_EVENT, {});
        if (!result.success) console.warn("Couldn't announce pair change:", result.error);
    } catch (err) {
        console.warn("Couldn't announce pair change:", err);
    } finally {
        await supabase.removeChannel(channel);
    }
};

// Loads a pair and checks the caller is one of its two devices. Sends the
// 404/403 response itself and returns null, so each route just does
// `if (!pair) return;`.
const findMyPair = async (id: string, deviceId: unknown, res: express.Response) => {
    if (typeof deviceId !== "string" || !deviceId) {
        res.status(400).json({ error: "deviceId is required" });
        return null;
    }
    const { data: pair } = await supabase.from("pairs").select("*").eq("id", id).single();
    if (!pair) {
        res.status(404).json({ error: "Pair not found" });
        return null;
    }
    if (pair.device_a !== deviceId && pair.device_b !== deviceId) {
        res.status(403).json({ error: "That's not your pair" });
        return null;
    }
    return { pair, amIA: pair.device_a === deviceId };
};

const createPair = async (req: express.Request, res: express.Response) => {
    const { deviceId } = req.body ?? {};
    if (typeof deviceId !== "string" || !deviceId) {
        res.status(400).json({ error: "deviceId is required" });
        return;
    }

    // clean up any code this device generated that nobody ever joined, plus
    // any expired unclaimed codes at all (piggybacking the sweep on an
    // existing write, rather than needing a separate scheduled job)
    await supabase.from("pairs").delete().eq("device_a", deviceId).is("device_b", null);
    await supabase
        .from("pairs")
        .delete()
        .is("device_b", null)
        .lt("created_at", new Date(Date.now() - PAIR_EXPIRATION_MS).toISOString());

    // A new code can (rarely) match an existing one - the unique constraint
    // then rejects the insert with Postgres error 23505. Just try a fresh code.
    let data = null;
    let error = null;
    for (let attempt = 0; attempt < 5; attempt++) {
        ({ data, error } = await supabase
            .from("pairs")
            .insert({ code: generateCode(), device_a: deviceId })
            .select("id, code")
            .single());
        if (error?.code !== "23505") break;
    }

    if (error || !data) {
        res.status(500).json({ error: "Could not create a pair" });
        return;
    }
    res.json({ id: data.id, code: data.code });
};

const joinPair = async (req: express.Request, res: express.Response) => {
    const { deviceId } = req.body ?? {};
    const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
    if (!deviceId || !code) {
        res.status(400).json({ error: "code and deviceId are required" });
        return;
    }

    const { data: existing, error: fetchError } = await supabase
        .from("pairs")
        .select("*")
        .eq("code", code)
        .single();

    if (fetchError || !existing) {
        res.status(404).json({ error: "Check the code and try again." });
        return;
    }

    // reconnecting to a pair this device is already part of
    if (existing.device_a === deviceId || existing.device_b === deviceId) {
        const amIA = existing.device_a === deviceId;
        await supabase
            .from("pairs")
            .update(amIA ? { device_a_active: true } : { device_b_active: true })
            .eq("id", existing.id);
        await announcePairChanged(existing.id);
        res.json({ id: existing.id, code: existing.code });
        return;
    }

    // claiming the open seat
    if (!existing.device_b) {
        if (isExpired(existing.created_at)) {
            res.status(404).json({ error: "This code has expired. Ask your special someone for a new one." });
            return;
        }
        const { data, error } = await supabase
            .from("pairs")
            .update({ device_b: deviceId })
            .eq("id", existing.id)
            .is("device_b", null) // guards the race if two people try to join at the same instant
            .select("id, code")
            .single();

        if (error || !data) {
            res.status(409).json({ error: "Someone may have just joined that code." });
            return;
        }
        await announcePairChanged(data.id);
        res.json({ id: data.id, code: data.code });
        return;
    }

    res.status(409).json({ error: "That code is taken - it already connects two other people." });
};

// Everything the app is allowed to know about its own pair. Never includes
// the partner's device id - that id works like a password for the routes
// above, so it stays on the server.
const getStatus = async (req: express.Request, res: express.Response) => {
    const mine = await findMyPair(req.params.id as string, req.body?.deviceId, res);
    if (!mine) return;
    const { pair, amIA } = mine;
    const partnerLat = amIA ? pair.lat_b : pair.lat_a;
    const partnerLon = amIA ? pair.lon_b : pair.lon_a;
    res.json({
        id: pair.id,
        code: pair.code,
        partnerLeft: !(amIA ? pair.device_b_active : pair.device_a_active),
        // rough (~10 km) - enough for sky maths, never an exact position
        partnerLocation: partnerLat != null && partnerLon != null ? { latitude: partnerLat, longitude: partnerLon } : null,
    });
};

// ~10 km precision: plenty to know when the moon is up somewhere, useless
// for finding someone's home. Rounded here, on the server, so a precise
// location is never stored even if an app sends one.
const roughly = (degrees: number) => Math.round(degrees * 10) / 10;

const setLocation = async (req: express.Request, res: express.Response) => {
    const { deviceId, latitude, longitude } = req.body ?? {};
    const id = req.params.id as string;
    if (
        typeof latitude !== "number" || typeof longitude !== "number" ||
        Math.abs(latitude) > 90 || Math.abs(longitude) > 180
    ) {
        res.status(400).json({ error: "latitude and longitude are required" });
        return;
    }

    const mine = await findMyPair(id, deviceId, res);
    if (!mine) return;
    const { pair, amIA } = mine;

    const lat = roughly(latitude);
    const lon = roughly(longitude);
    // only write + tell the other phone when it actually changed (e.g. travelling)
    if ((amIA ? pair.lat_a : pair.lat_b) !== lat || (amIA ? pair.lon_a : pair.lon_b) !== lon) {
        const { error } = await supabase
            .from("pairs")
            .update(amIA ? { lat_a: lat, lon_a: lon } : { lat_b: lat, lon_b: lon })
            .eq("id", id);
        if (error) {
            res.status(500).json({ error: "Could not save location" });
            return;
        }
        await announcePairChanged(id);
    }

    res.json({ ok: true });
};

const setPresence = async (req: express.Request, res: express.Response) => {
    const { deviceId, active } = req.body ?? {};
    const id = req.params.id as string;
    if (typeof active !== "boolean") {
        res.status(400).json({ error: "active is required" });
        return;
    }

    const mine = await findMyPair(id, deviceId, res);
    if (!mine) return;

    await supabase
        .from("pairs")
        .update(mine.amIA ? { device_a_active: active } : { device_b_active: active })
        .eq("id", id);
    await announcePairChanged(id);

    res.json({ ok: true });
};

// Expo push tokens look like "ExponentPushToken[...]"
const isPushToken = (token: unknown) => typeof token === "string" && /^ExponentPushToken\[.+\]$/.test(token);

// A phone's push "address", or null when its "looks up" toggle is off - then
// there's simply nowhere to send to. Never sent back out (not in /status).
const setPushTokenRoute = async (req: express.Request, res: express.Response) => {
    const { deviceId, token } = req.body ?? {};
    const id = req.params.id as string;
    if (token !== null && !isPushToken(token)) {
        res.status(400).json({ error: "token must be an Expo push token or null" });
        return;
    }
    const mine = await findMyPair(id, deviceId, res);
    if (!mine) return;

    const { error } = await supabase
        .from("pairs")
        .update(mine.amIA ? { push_token_a: token } : { push_token_b: token })
        .eq("id", id);
    if (error) {
        res.status(500).json({ error: "Could not save push token" });
        return;
    }
    res.json({ ok: true });
};

// Sends one push through Expo's push service. If Expo says the token is dead
// (app uninstalled etc.), forget it so we stop trying.
const sendPush = async (pairId: string, column: "push_token_a" | "push_token_b", to: string, title: string, body: string) => {
    try {
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ to, title, body, sound: "default", priority: "high", channelId: CHANNELS.lookUp }),
        });
        const result = await response.json();
        if (result?.data?.details?.error === "DeviceNotRegistered") {
            await supabase.from("pairs").update({ [column]: null }).eq("id", pairId);
        } else if (result?.data?.status !== "ok") {
            console.warn("Push not sent:", JSON.stringify(result));
        }
    } catch (err) {
        console.warn("Push not sent:", err);
    }
};

// After a push, stay quiet this long before sending that person another -
// so looking away and back a few times doesn't spam them.
const LOOK_UP_PAUSE_MS = 30 * 60 * 1000;
// When each phone last got a "looks up" push. In memory: if the server
// restarts it's forgotten, which at worst means one extra push.
const lastLookUpPush = new Map<string, number>();

// "I've been looking at the sun/moon for a few seconds and my special someone
// isn't in the app" - tell them, if they want to know and it's not too soon.
const lookingNow = async (req: express.Request, res: express.Response) => {
    const { deviceId, looking } = req.body ?? {};
    const id = req.params.id as string;
    if (looking !== "sun" && looking !== "moon") {
        res.status(400).json({ error: "looking must be sun or moon" });
        return;
    }
    const mine = await findMyPair(id, deviceId, res);
    if (!mine) return;
    const { pair, amIA } = mine;

    const column = amIA ? "push_token_b" : "push_token_a";
    const theirToken = pair[column];
    const theirDevice = amIA ? pair.device_b : pair.device_a;
    const theyStayed = amIA ? pair.device_b_active : pair.device_a_active; // not disconnected
    if (!theirToken || !theirDevice || !theyStayed) {
        res.json({ ok: true, sent: false });
        return;
    }

    const key = `${pair.id}:${theirDevice}`;
    if (Date.now() - (lastLookUpPush.get(key) ?? 0) < LOOK_UP_PAUSE_MS) {
        res.json({ ok: true, sent: false });
        return;
    }
    lastLookUpPush.set(key, Date.now());

    await sendPush(pair.id, column, theirToken, `Your special someone is looking at the ${looking} right now`, "Look up with them?");
    res.json({ ok: true, sent: true });
};

app.post("/api/pairs", createPair);
app.post("/api/pairs/join", joinLimiter, joinPair);
app.post("/api/pairs/:id/status", getStatus);
app.post("/api/pairs/:id/presence", setPresence);
app.post("/api/pairs/:id/location", setLocation);
app.post("/api/pairs/:id/push-token", setPushTokenRoute);
app.post("/api/pairs/:id/looking", lookingNow);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => {
    console.log(`Stellate API listening on port ${PORT}`);
});
