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
// `clean` / `clean_best` (levels finished without a hint) arrived later
// still. Same rule: if the column is not there yet, sync everything else
// rather than nothing. See docs/leaderboard-stats.sql.
let cleanSchema = true;

const COLS = () => [
  'name,avatar,levels,bonus,coins',
  extendedSchema ? ',stars,streak' : '',
  cleanSchema ? ',clean,clean_best' : '',
].join('');

export async function pushScore({ deviceId, name, avatar, levels, bonus, coins,
                                  stars, streak, clean, cleanBest }) {
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
    const row = withExtras
      ? { ...base, stars, streak, ...(cleanSchema ? { clean, clean_best: cleanBest } : {}) }
      : base;
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
  if (!res.ok && cleanSchema && res.status === 400) {
    cleanSchema = false;   // docs/leaderboard-stats.sql not applied yet
    res = await send(extendedSchema, nameIsKey);
  }
  if (!res.ok && extendedSchema && res.status === 400) {
    extendedSchema = false; // unknown column
    res = await send(false, nameIsKey);
  }
  if (!res.ok) throw new Error(`pushScore ${res.status}`);
}

// Look a player up by name so a new device can continue their game.
export async function fetchPlayer(name) {
  const ask = () => fetch(`${URL}?select=${COLS()}&name=eq.${encodeURIComponent(name)}&limit=1`,
    { headers: HEADERS, signal: timeoutSignal() });
  let res = await ask();
  if (!res.ok && cleanSchema && res.status === 400) { cleanSchema = false; res = await ask(); }
  if (!res.ok) throw new Error(`fetchPlayer ${res.status}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

export async function fetchTop(limit = 100) {
  const ask = () => fetch(
    `${URL}?select=${COLS()},device_id&order=levels.desc,bonus.desc,coins.desc&limit=${limit}`,
    { headers: HEADERS, signal: timeoutSignal() }
  );
  let res = await ask();
  if (!res.ok && cleanSchema && res.status === 400) { cleanSchema = false; res = await ask(); }
  if (!res.ok && extendedSchema && res.status === 400) { extendedSchema = false; res = await ask(); }
  if (!res.ok) throw new Error(`fetchTop ${res.status}`);
  return res.json();
}

// ------------------------------------------------------------ hlášení slov
// A report used to open a GitHub issue, which works for exactly one person
// and not for any of the children playing. It goes to the database instead.
// Reporting is a courtesy, never a blocker: if it fails, the player is told
// once and the game carries on.
const REPORTS = URL.replace(/\/leaderboard$/, '/word_reports');

export async function reportWord({ word, kind, level, player, deviceId }) {
  const res = await fetch(REPORTS, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify([{ word, kind, level, player, device_id: deviceId }]),
    signal: timeoutSignal(),
  });
  // 409 is the unique constraint: this phone has reported this word before.
  // That is a success as far as the player is concerned, and it is why this
  // is a plain insert rather than an upsert — an upsert names the conflicting
  // columns, and naming device_id means being able to read it, which the
  // public key deliberately cannot do.
  if (res.status === 409) return;
  if (!res.ok) throw new Error(`reportWord ${res.status}`);
}

// Used by tools/reports.mjs. The public key can read the report itself but
// not who sent it — see docs/word-reports.sql.
export async function fetchReports(status = 'new') {
  const res = await fetch(
    `${REPORTS}?select=id,created_at,word,kind,level,status&status=eq.${status}&order=created_at.desc&limit=200`,
    { headers: HEADERS, signal: timeoutSignal() });
  if (!res.ok) throw new Error(`fetchReports ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------- PIN
// A name can be locked with a four-digit PIN. The PIN is verified in the
// database, never here — see docs/leaderboard-pin.sql for why. These calls
// go to Postgres functions rather than the table.
//
// Everything degrades: until the migration has been run the functions do
// not exist, the calls 404, and the game falls back to the old direct
// write. That way deploying the client and running the SQL do not have to
// happen at the same moment.
let rpcReady = null; // null = unknown, true/false once we have seen a reply

async function rpc(fn, args) {
  const res = await fetch(`${URL.replace(/\/leaderboard$/, '')}/rpc/${fn}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(args),
    signal: timeoutSignal(),
  });
  if (res.status === 404) { rpcReady = false; return { missing: true }; }
  rpcReady = true;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`${fn} ${res.status}`);
    // PostgREST maps the function's 28000 to 403, not 400
    err.wrongPin = (res.status === 403 || res.status === 400) && /wrong pin/i.test(body);
    err.body = body;
    throw err;
  }
  return { data: await res.json() };
}

export function pinSupported() { return rpcReady; }

// Is this name free, and is it locked? Used before creating a player so a
// newcomer is told the name is taken instead of silently adopting someone.
export async function nameStatus(name) {
  const { missing, data } = await rpc('player_status', { p_name: name });
  if (missing) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { taken: !!row.taken, locked: !!row.locked, levels: row.levels ?? 0, avatar: row.avatar } : null;
}

// Returns { ok, reason, hint, ...progress }. reason is one of
// unknown | nopin | ok | wrong | blocked.
export async function signIn(name, pin) {
  const { missing, data } = await rpc('sign_in', { p_name: name, p_pin: pin ?? null });
  if (missing) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? null;
}

export async function setPin(name, oldPin, newPin, hint) {
  const { missing } = await rpc('set_pin', {
    p_name: name, p_old_pin: oldPin ?? null, p_new_pin: newPin, p_hint: hint ?? null,
  });
  return !missing;
}

// Score push that carries the PIN. Falls back to the direct table write
// when the migration has not been run yet.
export async function pushScorePin(p) {
  const args = {
    p_name: p.name, p_pin: p.pin ?? null, p_device: p.deviceId, p_avatar: p.avatar,
    p_levels: p.levels, p_bonus: p.bonus, p_coins: p.coins,
    p_stars: p.stars, p_streak: p.streak,
  };
  const withClean = cleanSchema;
  if (withClean) { args.p_clean = p.clean ?? 0; args.p_clean_best = p.cleanBest ?? 0; }

  // Sending two arguments the stored function does not take makes PostgREST
  // answer "no such function" — a 404, the same answer as a database with no
  // PIN functions at all. Telling those two apart matters: treating this one
  // as "no functions here" would send every score down the direct-write path,
  // which PIN-locked names are not allowed to take, and their scores would
  // stop saving until the SQL was run. So retry the same call without the new
  // arguments first, and only then conclude the functions are missing.
  const call = async () => {
    try {
      return await rpc('save_score', args);
    } catch (err) {
      if (err.wrongPin || !withClean) throw err;
      return { badArgs: true };
    }
  };
  let out = await call();
  if ((out.missing || out.badArgs) && withClean) {
    cleanSchema = false;   // docs/leaderboard-stats.sql has not been run yet
    delete args.p_clean;
    delete args.p_clean_best;
    out = await rpc('save_score', args);
  }
  if (out.missing) return pushScore(p);
}
