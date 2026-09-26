# Stellate

App where two people pair up with a 6 character code and can see exactly where the sun/moon actually is in the sky right now, wherever they are, so they can feel a sort of connection.

## How it works

- One person creates a connection and gets a code
- They share the code, the other person joins with it
- Both land on the sky screen, which uses location + the phone's sensors to find the sun (or moon if it's night) and shows where to point your phone to see it
- You can see if your partner has the app open, and disconnect/reconnect anytime with the same code

## What I used

- Expo / React Native for the app
- Supabase for the database, and to keep things live between the two people (so you see when your partner connects/disconnects)
- A small Express server for the more sensitive stuff (creating a pair, joining, updating presence) instead of doing it straight from the phone
- zustand for the bit of state shared between the two screens (device id, current pair)
- suncalc to calculate where the sun/moon actually is
- expo-location + expo-sensors for gps and compass/accelerometer stuff, to know where the phone is pointing

## Project folders

- src/app - the two screens
- src/components - the sky viewfinder (the icon + arrow that track the sun/moon)
- src/hooks - one file per feature (location, phone orientation, sun/moon position, pair info)
- src/store - the shared pair/device state
- src/lib - supabase client + calls to my own backend
- server - the backend

## Why there's a backend

Supabase's key in the app is public on purpose, so the real security has to come from rules on the database side. That worked for most things, but there were a couple things those rules couldn't really do (like stopping someone from listing every single pair code, or rate limiting/code expiring). So I made a small backend that holds the actual secret key and does those checks in normal code instead.

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

alter table pairs enable row level security;

create policy "anyone can read pairs"
  on pairs for select
  using (true);

alter publication supabase_realtime add table pairs;
```

3. Copy `.env.example` to `.env` (root folder) and fill in your Supabase project's url + public key
4. Copy `server/.env.example` to `server/.env` and fill in the same url + the service role key (a different, secret one — don't share this file with anyone)
5. Run `npm run server` in one terminal, `npm start` in another

The app finds my computer automatically while developing, no need to type in an IP address. That only works while the phone is on the same wifi though — for it to actually work between two people far apart, the server would need to be hosted somewhere real instead of just running on a laptop.
