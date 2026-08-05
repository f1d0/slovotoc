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

export async function pushScore({ deviceId, name, avatar, levels, bonus, coins }) {
  const row = {
    device_id: deviceId,
    name,
    avatar,
    levels,
    bonus,
    coins,
    updated_at: new Date().toISOString(),
  };
  const res = await fetch(`${URL}?on_conflict=device_id,name`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([row]),
    signal: timeoutSignal(),
  });
  if (!res.ok) throw new Error(`pushScore ${res.status}`);
}

export async function fetchTop(limit = 100) {
  const res = await fetch(
    `${URL}?select=name,avatar,levels,bonus,coins,device_id&order=levels.desc,bonus.desc,coins.desc&limit=${limit}`,
    { headers: HEADERS, signal: timeoutSignal() }
  );
  if (!res.ok) throw new Error(`fetchTop ${res.status}`);
  return res.json();
}
