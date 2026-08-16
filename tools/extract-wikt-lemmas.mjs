// Extract Czech dictionary headwords (lemmas) from the kaikki.org
// Wiktionary extraction (JSONL). Entries whose senses are only
// "form-of"/"alt-of" references are inflected forms, not headwords, and are
// skipped — this is what guarantees crossword words are real dictionary
// words (KOLO, OKO…), never inflections ("kol", "jsme"…).
//
// Usage: node tools/extract-wikt-lemmas.mjs [in.jsonl] [out.txt]

import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { CZECH_RE, isClean } from './wordfilter.mjs';

const IN = process.argv[2] ?? '/workspace/kaikki-cs.jsonl';
const OUT = process.argv[3] ?? '/workspace/wikt-cs-lemmas.txt';

const GOOD_POS = new Set([
  'noun', 'verb', 'adj', 'adv', 'num', 'pron', 'prep', 'conj', 'particle',
]);

// Some form-of entries carry the relation only in the gloss text
// ("vocative/locative singular of čas"), with no structured form_of field.
const FORM_GLOSS = /\b(nominative|genitive|dative|accusative|vocative|locative|instrumental|singular|plural|comparative|superlative|participle|transgressive)\b[^.]*\bof\b/i;

function isFormSense(s) {
  if (s.form_of || s.alt_of) return true;
  if ((s.tags ?? []).includes('form-of')) return true;
  const gloss = (s.glosses ?? [])[0] ?? '';
  return FORM_GLOSS.test(gloss);
}

const lemmas = new Set();
let entries = 0, formOnly = 0;

const rl = createInterface({ input: createReadStream(IN), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  if (e.lang_code !== 'cs' || !e.word) continue;
  entries++;
  const w = e.word;
  if (w.length < 3 || w.length > 8) continue;
  if (!CZECH_RE.test(w)) continue;          // lowercase Czech letters only
  if (!GOOD_POS.has(e.pos)) continue;
  if (!isClean(w)) continue;
  const senses = e.senses ?? [];
  const hasLemmaSense = senses.some(s => !isFormSense(s));
  if (!hasLemmaSense) { formOnly++; continue; }
  lemmas.add(w);
}

writeFileSync(OUT, [...lemmas].sort().join('\n') + '\n');
console.error(`entries=${entries} form-only-skipped=${formOnly} lemmas(3-8)=${lemmas.size} -> ${OUT}`);
