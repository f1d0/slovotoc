// Shows the words players have reported through the ⚑ button.
//
//   node tools/reports.mjs            # what is waiting
//   node tools/reports.mjs --all      # including ones already dealt with
//
// Reports land in Supabase (docs/word-reports.sql), not in GitHub issues:
// none of the people playing this have a GitHub account. The public key can
// read the report but not who sent it, so nothing identifying comes out here
// — open the Table editor in Supabase for that.
//
// Dealing with one is two steps: put the word in tools/extra-words.txt with a
// note about what it is, run `npm run words`. Then set the row's status to
// 'added' (or 'rejected') in Supabase so it stops showing up.

import { readFileSync } from 'node:fs';
import { fetchReports } from '../web/js/leaderboard.js';

const all = process.argv.includes('--all');
const known = new Set(
  readFileSync(new URL('./extra-words.txt', import.meta.url).pathname, 'utf8')
    .split('\n').map(l => l.split('#')[0].trim().toLowerCase()).filter(Boolean)
);

const rows = [];
for (const status of all ? ['new', 'added', 'rejected'] : ['new']) {
  rows.push(...await fetchReports(status));
}
if (!rows.length) { console.log('Žádná nová hlášení.'); process.exit(0); }

const KIND = { missing: 'mělo být uznáno', wrong: 'tohle není slovo' };
rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
for (const r of rows) {
  const when = new Date(r.created_at).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' });
  const mark = known.has(r.word) ? ' (už v extra-words.txt)' : '';
  console.log(
    `#${String(r.id).padEnd(4)} ${when}  ${r.word.toUpperCase().padEnd(12)}` +
    `${(KIND[r.kind] ?? r.kind).padEnd(18)} úroveň ${String((r.level ?? 0) + 1).padEnd(4)}` +
    `${r.status === 'new' ? '' : '[' + r.status + '] '}${mark}`
  );
}
console.log(`\n${rows.length} hlášení. Přidat slovo: tools/extra-words.txt → npm run words`);
