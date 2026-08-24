// Kid-safe word filter for Czech word lists.
// The game is meant for families/kids, so vulgar and offensive words are
// excluded from BOTH the crossword targets and the accepted bonus words.
// Strategy: substring stems where safe, anchored prefixes where a bare stem
// would hit innocent words (e.g. "pič" appears in "kapička", "lupič"),
// plus explicit forms for irregular families and an exception list.

const SUBSTRING_STEMS = [
  'hovn', 'hovín', 'hovad',
  'kurv', 'kurev',
  'mrd',
  'jeb',
  'šuk', 'šoust',
  'kokot',
  'čurák', 'čurác', 'čůrák', 'čůrác',
  'chcank', 'chcát', 'chčij', 'chcíp',
  'sračk', 'sráč',
  'posran', 'nasran', 'zasran', 'vysran', 'usran',
  'prd',
  'kund',
  'kokotin', 'šulin', 'chuj', 'čubk', 'děvk',
  'negr', 'buzn', 'buzer', 'hajzl',
  'debil', 'kretén', 'kretin', 'idiot',
  'onan', 'masturb', 'soulož', 'porno', 'erotic', 'erotik',
  'penis', 'vagin', 'vagín', 'varlat', 'nadrž',
  'fuck', 'shit', 'bitch',
];

const PREFIX_STEMS = [
  'pič', 'píč',            // piča, píčo, pičus… (bare stem hits kapička/lupič)
  'ser',                   // seru, sereš… (bare stem hits servis/seriál — see exceptions)
  'sex',                   // (bare stem would hit sexta etc. — prefix is enough)
];

const EXPLICIT_WORDS = new Set([
  'hoven', 'sraček',
  'srát', 'sral', 'srala', 'sralo', 'srali', 'sraly', 'srán', 'sráno',
  'vysrat', 'posrat', 'nasrat', 'zasrat', 'usrat', 'prosrat',
  'vysral', 'posral', 'nasral', 'zasral', 'usral', 'prosral',
  'vole', 'krypl', 'magor', 'magoři', 'magora', 'magorům',
  'sperma', 'spermat', 'spermatu', 'spermie', 'spermií',
  'bordelu', 'štětko',
  // Neither of these can be a stem: "prc" would swallow prcek/prcka and
  // "svin" would swallow svinout/svinovat, all perfectly innocent.
  'prcat', 'prcá', 'prcal', 'prcala', 'prcali', 'prcám', 'prcáš', 'prcání',
  'zaprcat', 'vyprcat', 'naprcat',
  'svině', 'svine', 'svini', 'sviní', 'svinětem', 'svinstvo', 'svinstva',
]);

// Innocent words/stems that would otherwise be caught above.
const EXCEPTIONS = [
  'sekund',   // sekunda … vs "kund"
  'šmrdol',   // šmrdolit … vs "mrd"
  'servis', 'seriál', 'serial', 'serv', 'serií', 'serie', 'sérií', 'série',
  'serpent',  // vs prefix "ser"
  'seržant',
];

export function isClean(word) {
  const w = word.toLowerCase();
  for (const ex of EXCEPTIONS) {
    if (w.includes(ex)) return true;
  }
  if (EXPLICIT_WORDS.has(w)) return false;
  for (const stem of SUBSTRING_STEMS) {
    if (w.includes(stem)) return false;
  }
  for (const stem of PREFIX_STEMS) {
    if (w.startsWith(stem)) return false;
  }
  return true;
}

// Valid Czech letters for the game (lowercase, diacritics are distinct tiles).
export const CZECH_RE = /^[a-záčďéěíňóřšťúůýž]+$/;

export function isPlayable(word, minLen = 3, maxLen = 8) {
  return word.length >= minLen && word.length <= maxLen && CZECH_RE.test(word) && isClean(word);
}

// ---------------------------------------------------------------- names
// A player name is shown to everyone on the shared board, so it goes through
// the same filter the word list does. People trying it on will not type the
// word plainly, though, so the name is flattened first: diacritics folded,
// separators dropped, and the usual digit-for-letter swaps undone. That turns
// "K.0-k0t" into "kokot" before the check ever runs.
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '6': 'g',
               '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i',
               // Polish spelling and the usual keyboard slip: kurwa -> kurva
               'w': 'v' };
const FOLD_NAME = { 'á':'a','č':'c','ď':'d','é':'e','ě':'e','í':'i','ň':'n','ó':'o',
                    'ř':'r','š':'s','ť':'t','ú':'u','ů':'u','ý':'y','ž':'z' };

export function flattenName(name) {
  return [...String(name).toLowerCase()]
    .map(c => FOLD_NAME[c] ?? LEET[c] ?? c)
    .join('')
    .replace(/[^a-z]/g, '');
}

// The stem lists carry diacritics ("pič", "sračk"), so flattening the name
// alone would let "pica" and "sracka" straight through. The stems get the
// same flattening, and a name has to pass both readings.
const foldAll = w => [...w].map(c => FOLD_NAME[c] ?? c).join('');
const FLAT_SUBSTRING = SUBSTRING_STEMS.map(foldAll);
const FLAT_PREFIX = PREFIX_STEMS.map(foldAll);
const FLAT_EXPLICIT = new Set([...EXPLICIT_WORDS].map(foldAll));
const FLAT_EXCEPTIONS = EXCEPTIONS.map(foldAll);

function isCleanFlat(w) {
  for (const ex of FLAT_EXCEPTIONS) if (w.includes(ex)) return true;
  if (FLAT_EXPLICIT.has(w)) return false;
  for (const stem of FLAT_SUBSTRING) if (w.includes(stem)) return false;
  for (const stem of FLAT_PREFIX) if (w.startsWith(stem)) return false;
  return true;
}

// Returns null when the name is fine, otherwise a reason the caller can show.
export function nameProblem(name) {
  const raw = String(name).trim();
  if (!raw) return 'empty';
  if ([...raw].length > 14) return 'long';
  const lower = raw.toLowerCase();
  const flat = flattenName(raw);
  if (!flat) return 'nonsense';
  // three readings: as typed, flattened, and flattened with runs collapsed
  // ("kokooot"). Any one of them landing on a stem is enough.
  if (!isClean(lower) || !isCleanFlat(flat)) return 'rude';
  if (!isCleanFlat(flat.replace(/(.)\1+/g, '$1'))) return 'rude';
  return null;
}
