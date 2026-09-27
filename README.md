# Stellate

App where two people pair up with a 6 character code and can see exactly where the sun/moon actually is in the sky right now, wherever they are, so they can feel a sort of connection.

## How it works

- One person creates a connection and gets a code; the other person joins with it
- Both land on the sky screen: GPS + the phone's compass and accelerometer work out where the phone points, and the real sky is drawn around you - sun, moon (with tonight's phase), stars, clouds, colours for the time of day
- An arrow guides you to the sun or moon; finding it gives a haptic tap
- You see if your special someone has the app open and what they're looking at. A pink light on your horizon shows which way they are (and how far), and a line joins it to the sky while they look up
- When you're both looking up at once, the edges glow, you feel a few heartbeats, and "time together" counts up
- Optional notifications: when the sun/moon is up for both of you, and when your special someone looks up

## Assignment requirements

- **Expo SDK:** expo-location (GPS), expo-sensors (accelerometer + magnetometer), expo-haptics, expo-notifications (push + scheduled), expo-keep-awake, expo-clipboard, expo-crypto, expo-font, expo-splash-screen, expo-router
- **Third-party libraries (from the Expo docs sidebar):** @shopify/react-native-skia (drawing the sky), react-native-reanimated (running it on the UI thread), react-native-svg, @react-native-async-storage/async-storage, react-native-safe-area-context
- **Native-only features:** reading the compass and accelerometer to know where the phone points, GPS, haptics, push and scheduled notifications, keeping the screen awake, the share sheet

## Setup

1. `npm install`
2. Make a Supabase project, run this in its SQL editor:

```sql
create table pairs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  device_a uuid,
  device_b uuid,
  push_token_a text,
  push_token_b text,
  created_at timestamptz not null default now(),
  device_a_active boolean not null default true,
  device_b_active boolean not null default true
);

-- rough locations (~10 km), for "moon is up for both of you" reminders
alter table pairs
  add column lat_a double precision, add column lon_a double precision,
  add column lat_b double precision, add column lon_b double precision;

-- RLS on with no policies at all = the public key in the app can't read or
-- write this table. Only the server (secret service role key) can.
alter table pairs enable row level security;
```

Live updates don't come from the table: the server sends a small "pair-changed" message over a Supabase Realtime channel whenever a pair changes, and the app then asks the server for its new status.

3. Copy `.env.example` to `.env` (root folder) and fill in your Supabase project's url + public key
4. Copy `server/.env.example` to `server/.env` and fill in the same url + the service role key (a different, secret one - don't share this file with anyone)
5. Run `npm run server` in one terminal, `npm start` in another

The app finds my computer automatically while developing, no need to type in an IP address. That only works while the phone is on the same wifi though - for it to actually work between two people far apart, the server would need to be hosted somewhere real instead of just running on a laptop.
