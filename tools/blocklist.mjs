// Words that must never appear as a crossword answer (inflected forms,
// foreign leakage, obscure leftovers). They stay valid as BONUS words.

export const TARGET_BLOCKLIST = new Set([
  'praze', 'prahy', 'prahou', 'brně', 'plzni', 'ostravě',
  'honzo', 'honzy', 'honzou', 'pepo', 'pepy', 'tondo', 'jirko', 'jirky',
  'tome', 'tomovi', 'tomem', 'jacku', 'johne', 'jime', 'jime',
  'hmm', 'ehm', 'ehh', 'ooh', 'uhm', 'mmm', 'ummm', 'umm', 'hmmm',
  'ehmm', 'ach', 'och', 'oj', 'aj', 'ó', 'ech', 'jem', 'jme', 'mamá',
  // English/subtitle leakage & name vocatives that pass the other filters
  'cape', 'con', 'cool', 'done', 'end', 'email', 'ido', 'kit', 'like',
  'live', 'rito', 'sale', 'som', 'son', 'tao', 'vito', 'boy', 'boye',
  'jane', 'dane', 'kate', 'katy', 'petře', 'anno', 'inch', 'copy',
  'lady', 'lord', 'lorda', 'miss', 'sir', 'okay', 'baby', 'core',
  'look', 'hot', 'stone', 'salt', 'net', 'star', 'jam', 'bat', 'pako', 'trip',
  'dne', // mistagged as a headword in the Wiktionary extraction
  'mne', 'mně', 'tebe', 'tobě', 'sebe', 'sobě', // pronoun case forms
  'love', 'péro', 'osle', 'prso', 'kol', 'jsi', 'jest',
  // obscure or non-headword leftovers that slip through the frequency filter
  'kon', 'kale', 'lat', 'kel', 'atol', 'kalo', 'kolt', 'katr', 'ethan',
  'talon', 'stěr', 'potěr', 'kra', 'lín', 'sto', 'tur', 'lka', 'nes',
]);
