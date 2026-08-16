// Global leaderboard backed by Supabase (free tier). The key below is the
// project's public "anon" key – it is meant to be shipped in client code;
// access is controlled by row-level-security policies in the database.

const URL = 'https://gshjjnzgqptmbumsymbh.supabase.co/rest/v1/leaderboard';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzaGpqbnpncXB0bWJ1bXN5bWJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NDQzNDQsImV4cCI6MjEwMTUyMDM0NH0.zpJ5LPTOI0gDKhQqV96EN9esD4EYzdHqMboOIlPq3lM';

const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

// A hanging request must never leave the player staring at a spinner, so
// every call gives up and lets the caller fall back to local data.
const TIMEOUT_MS = 6000;

function timeoutSignal() {
  if (AbortSignal.timeout) return AbortSignal.timeout(TIMEOUT_MS);
  const c = new AbortController();
  setTimeout(() => c.abort(), TIMEOUT_MS);
  return c.signal;
}

// `stars` and `streak` were added after the first release. If the database
// hasn't got those columns yet the game keeps working on the older schema
// instead of failing to sync at all.
let extendedSchema = true;
// Identity is the player's name once docs/leaderboard-migrace.sql has run.
// Until then the database still keys rows by (device_id, name), so the
// client works either way instead of failing to sync.
let nameIsKey = true;

export async function pushScore({ deviceId, name, avatar, levels, bonus, coins, stars, streak }) {
  const base = {
    device_id: deviceId,
    name,
    avatar,
    levels,
    bonus,
    coins,
    updated_at: new Date().toISOString(),
  };
  const send = async (withExtras, byName) => {
    const row = withExtras ? { ...base, stars, streak } : base;
    return fetch(`${URL}?on_conflict=${byName ? 'name' : 'device_id,name'}`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([row]),
      signal: timeoutSignal(),
    });
  };

  let res = await send(extendedSchema, nameIsKey);
  if (!res.ok && nameIsKey && (res.status === 400 || res.status === 409)) {
    nameIsKey = false; // migration not applied yet
    res = await send(extendedSchema, false);
  }
  if (!res.ok && extendedSchema && res.status === 400) {
    extendedSchema = false; // unknown column
    res = await send(false, nameIsKey);
  }
  if (!res.ok) throw new Error(`pushScore ${res.status}`);
}

// Look a player up by name so a new device can continue their game.
export async function fetchPlayer(name) {
  const cols = extendedSchema
    ? 'name,avatar,levels,bonus,coins,stars,streak'
    : 'name,avatar,levels,bonus,coins';
  const res = await fetch(`${URL}?select=${cols}&name=eq.${encodeURIComponent(name)}&limit=1`,
    { headers: HEADERS, signal: timeoutSignal() });
  if (!res.ok) throw new Error(`fetchPlayer ${res.status}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

export async function fetchTop(limit = 100) {
  const cols = extendedSchema
    ? 'name,avatar,levels,bonus,coins,stars,streak,device_id'
    : 'name,avatar,levels,bonus,coins,device_id';
  let res = await fetch(
    `${URL}?select=${cols}&order=levels.desc,bonus.desc,coins.desc&limit=${limit}`,
    { headers: HEADERS, signal: timeoutSignal() }
  );
  if (!res.ok && extendedSchema && res.status === 400) {
    extendedSchema = false;
    res = await fetch(
      `${URL}?select=name,avatar,levels,bonus,coins,device_id&order=levels.desc,bonus.desc,coins.desc&limit=${limit}`,
      { headers: HEADERS, signal: timeoutSignal() }
    );
  }
  if (!res.ok) throw new Error(`fetchTop ${res.status}`);
  return res.json();
}
