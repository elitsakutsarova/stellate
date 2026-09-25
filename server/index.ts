import path from "node:path";
import dotenv from "dotenv";

// resolve relative to this file, not the current working directory, so
// `npm run server` works the same regardless of where it's run from
dotenv.config({ path: path.join(__dirname, ".env") });

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy server/.env.example to server/.env and fill them in."
    );
}

// The service role key bypasses Row Level Security entirely. That's safe
// here specifically because this client only ever runs on the server —
// it's never bundled into the app, so nobody outside this process can use
// it. All the "who's allowed to do what" checks this route file performs
// take the place of RLS for these operations.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// A generous baseline for every route, so a single client/script can't
// hammer the API unbounded — most abuse of any kind gets caught here.
app.use(
    "/api",
    rateLimit({
        windowMs: 60 * 1000,
        limit: 60,
        standardHeaders: true,
        legacyHeaders: false,
    })
);

// Much stricter on join specifically — this is the endpoint someone would
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

// Unclaimed codes older than this are treated as expired — bounds how
// long a code stays guessable if nobody ever joins it, rather than
// leaving it valid (and brute-forceable) forever.
const PAIR_EXPIRATION_MS = 24 * 60 * 60 * 1000;
const isExpired = (createdAt: string) => Date.now() - new Date(createdAt).getTime() > PAIR_EXPIRATION_MS;

const generateCode = () => {
    // no confusing characters like 0/O or 1/I — matches the app's old client-side generator
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
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

    const code = generateCode();
    const { data, error } = await supabase
        .from("pairs")
        .insert({ code, device_a: deviceId })
        .select("id, code")
        .single();

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
        res.json({ id: existing.id, code: existing.code });
        return;
    }

    // claiming the open seat
    if (!existing.device_b) {
        if (isExpired(existing.created_at)) {
            res.status(404).json({ error: "This code has expired. Ask your partner for a new one." });
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
        res.json({ id: data.id, code: data.code });
        return;
    }

    res.status(409).json({ error: "That code is taken — it already connects two other people." });
};

const setPresence = async (req: express.Request, res: express.Response) => {
    const { deviceId, active } = req.body ?? {};
    const { id } = req.params;
    if (!deviceId || typeof active !== "boolean") {
        res.status(400).json({ error: "deviceId and active are required" });
        return;
    }

    const { data: pair } = await supabase.from("pairs").select("device_a, device_b").eq("id", id).single();
    if (!pair) {
        res.status(404).json({ error: "Pair not found" });
        return;
    }
    if (pair.device_a !== deviceId && pair.device_b !== deviceId) {
        res.status(403).json({ error: "That's not your pair" });
        return;
    }

    const amIA = pair.device_a === deviceId;
    await supabase
        .from("pairs")
        .update(amIA ? { device_a_active: active } : { device_b_active: active })
        .eq("id", id);

    res.json({ ok: true });
};

app.post("/api/pairs", createPair);
app.post("/api/pairs/join", joinLimiter, joinPair);
app.post("/api/pairs/:id/presence", setPresence);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => {
    console.log(`Stellate API listening on port ${PORT}`);
});
