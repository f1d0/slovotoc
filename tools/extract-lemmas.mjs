// Build the Czech headword (lemma) list used for crossword answers, merging
// two Wiktionary editions: the English one (kaikki "Czech") and the much
// larger Czech one (kaikki "čeština").
//
// Only true headwords are kept — entries that merely describe an inflected
// form ("2. pád ...", "vocative of ...") are dropped, so a grid never asks
// for something like "kol" or "jsme".
//
// Usage: node tools/extract-lemmas.mjs [out.txt]

import { createReadStream, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { CZECH_RE, isClean } from './wordfilter.mjs';

const EN = process.env.KAIKKI_EN ?? '/workspace/kaikki-cs.jsonl';
const CS = process.env.KAIKKI_CS ?? '/workspace/kaikki-cswikt.jsonl';
const OUT = process.argv[2] ?? '/workspace/cs-lemmas.txt';

// English-edition part-of-speech codes worth having in a word game
const EN_POS = new Set(['noun', 'verb', 'adj', 'adv', 'num', 'pron', 'prep', 'conj', 'particle']);
// Czech-edition pos_title values; multi-word entries, abbreviations and
// idioms are deliberately excluded
const CS_POS = new Set([
  'podstatné jméno', 'přídavné jméno', 'sloveso', 'příslovce',
  'zájmeno', 'číslovka', 'spojka', 'předložka', 'částice',
]);

// gloss wording used by both editions when an entry is just an inflection
const FORM_GLOSS_EN = /\b(nominative|genitive|dative|accusative|vocative|locative|instrumental|singular|plural|comparative|superlative|participle|transgressive)\b[^.]*\bof\b/i;
const FORM_GLOSS_CS = /(^|\s)(tvar|[1-7]\.\s*pád|jednotné číslo|množné číslo|příčestí|přechodník|stupňování|zdrobnělina od|zkratka)/i;

function isFormSense(s) {
  if (s.form_of || s.alt_of) return true;
  if ((s.tags ?? []).includes('form-of')) return true;
  const gloss = (s.glosses ?? [])[0] ?? '';
  return FORM_GLOSS_EN.test(gloss) || FORM_GLOSS_CS.test(gloss);
}

function playable(w) {
  return w.length >= 3 && w.length <= 8 && CZECH_RE.test(w) && isClean(w);
}

async function harvest(file, posField, posSet, label) {
  if (!existsSync(file)) {
    console.error(`! ${label}: ${file} chybí, přeskakuji`);
    return new Set();
  }
  const out = new Set();
  let entries = 0, skippedForms = 0;
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.lang_code !== 'cs' || !e.word) continue;
    entries++;
    const w = e.word.toLowerCase();
    if (!playable(w)) continue;
    if (!posSet.has(e[posField] ?? e.pos)) continue;
    const senses = e.senses ?? [];
    if (!senses.some(s => !isFormSense(s))) { skippedForms++; continue; }
    out.add(w);
  }
  console.error(`${label}: ${entries} hesel → ${out.size} lemmat (tvarů zahozeno: ${skippedForms})`);
  return out;
}

const en = await harvest(EN, 'pos', EN_POS, 'en.wiktionary');
const cs = await harvest(CS, 'pos_title', CS_POS, 'cs.wiktionary');

const all = new Set([...en, ...cs]);
writeFileSync(OUT, [...all].sort().join('\n') + '\n');
console.error(`\nsjednoceno: ${all.size} lemmat (jen en: ${en.size}, jen cs: ${cs.size}) → ${OUT}`);
