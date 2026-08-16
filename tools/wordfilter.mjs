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
