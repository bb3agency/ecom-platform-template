import { HSN_DATASET } from './hsn-dataset';

export type HsnSuggestion = {
  code: string;
  description: string;
};

/**
 * Keyword search over the vendored WCO Harmonized System dataset (see hsn-dataset.ts)
 * powering the "auto-fill HSN" suggestions in the admin product editor.
 *
 * Scoring is deliberately simple + deterministic:
 *  - a digits-only query matches codes by prefix (typing "0904" lists its subheadings);
 *  - text queries tokenize and require EVERY token to appear in the description
 *    (word-prefix matches count more than mid-word hits);
 *  - 6-digit subheadings outrank 4-digit headings (more specific = better autofill);
 *  - shorter descriptions win ties (usually the more canonical entry).
 */
export function suggestHsnCodes(query: string, limit = 8): HsnSuggestion[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  if (/^\d{2,8}$/.test(q)) {
    return HSN_DATASET.filter(([code]) => code.startsWith(q))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([code, description]) => ({ code, description }));
  }

  const tokens = q
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
    // Drop pack-size tokens ("500gms", "1kg") and generic merchandising words that
    // appear in product names but never in HS nomenclature
    // ("Organic Sambar Kaaram 250gms Pack" → "sambar kaaram").
    .filter((t) => !/^\d/.test(t))
    .filter((t) => !GENERIC_TOKENS.has(t));
  if (tokens.length === 0) return [];

  const scored: Array<{ score: number; code: string; description: string }> = [];
  for (const [code, description] of HSN_DATASET) {
    const desc = description.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const token of tokens) {
      // Indian trade terms (ghee, jaggery, namkeen…) don't appear in the WCO's
      // international wording — the alias map resolves them to HS code prefixes.
      const aliasPrefixes = INDIAN_TERM_TO_HS[token];
      if (aliasPrefixes?.some((prefix) => code.startsWith(prefix))) {
        matched += 1;
        score += 5;
        continue;
      }
      const at = desc.indexOf(token);
      if (at === -1) continue;
      matched += 1;
      // Word-boundary prefix match is worth more than a mid-word hit.
      score += at === 0 || /[^a-z0-9]/.test(desc[at - 1] ?? ' ') ? 3 : 1;
    }
    if (matched === 0) continue;
    // Require a majority of tokens — a strict all-token rule returns nothing for real
    // product names ("Sambar Kaaram": only "kaaram" resolves), while any-token is noise.
    // Scoring still ranks fuller matches first.
    if (matched < Math.ceil(tokens.length / 2)) continue;
    if (code.length === 6) score += 2; // prefer specific subheadings
    scored.push({ score, code, description });
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.description.length - b.description.length ||
        a.code.localeCompare(b.code)
    )
    .slice(0, limit)
    .map(({ code, description }) => ({ code, description }));
}

/**
 * Common Indian trade/product terms → HS code prefixes. The WCO nomenclature uses
 * international wording ("fats and oils derived from milk", not "ghee"), so these
 * aliases are what make suggestions work for Indian storefronts. Prefixes, not exact
 * codes — all matching subheadings surface and the specific ones rank first.
 */
const INDIAN_TERM_TO_HS: Record<string, string[]> = {
  ghee: ['0405'],
  butter: ['0405'],
  paneer: ['0406'],
  cheese: ['0406'],
  curd: ['0403'],
  yogurt: ['0403'],
  lassi: ['0403'],
  milk: ['0401', '0402'],
  honey: ['0409'],
  jaggery: ['1701'],
  gur: ['1701'],
  sugar: ['1701'],
  atta: ['1101'],
  maida: ['1101'],
  flour: ['1101', '1102'],
  besan: ['1106'],
  sooji: ['1103'],
  rava: ['1103'],
  rice: ['1006'],
  poha: ['1904'],
  wheat: ['1001'],
  millet: ['1008'],
  dal: ['0713'],
  lentil: ['0713'],
  pulses: ['0713'],
  chana: ['0713'],
  moong: ['0713'],
  toor: ['0713'],
  urad: ['0713'],
  turmeric: ['091030'],
  haldi: ['091030'],
  chilli: ['0904'],
  chillies: ['0904'],
  mirchi: ['0904'],
  kaaram: ['0904'],
  pepper: ['0904'],
  cardamom: ['0908'],
  elaichi: ['0908'],
  cumin: ['0909'],
  jeera: ['0909'],
  coriander: ['0909'],
  dhania: ['0909'],
  ginger: ['0910'],
  garlic: ['0703'],
  masala: ['0910', '2103'],
  spice: ['0910'],
  spices: ['0910'],
  podi: ['0910'],
  pickle: ['2001'],
  pickles: ['2001'],
  achar: ['2001'],
  papad: ['1905'],
  biscuit: ['1905'],
  biscuits: ['1905'],
  cookies: ['1905'],
  bread: ['1905'],
  cake: ['1905'],
  rusk: ['1905'],
  murukku: ['1905'],
  namkeen: ['2106'],
  snack: ['2106', '1905'],
  snacks: ['2106', '1905'],
  mixture: ['2106'],
  sweets: ['2106', '1704'],
  mithai: ['2106'],
  laddu: ['2106'],
  ladoo: ['2106'],
  halwa: ['2106'],
  burfi: ['2106'],
  barfi: ['2106'],
  chocolate: ['1806'],
  tea: ['0902'],
  coffee: ['0901'],
  cashew: ['0801'],
  almond: ['0802'],
  badam: ['0802'],
  raisins: ['0806'],
  kismis: ['0806'],
  peanut: ['1202', '2008'],
  groundnut: ['1202', '2008'],
  sesame: ['1207'],
  til: ['1207'],
  soap: ['3401'],
  shampoo: ['3305'],
  candle: ['3406'],
  agarbatti: ['3307'],
  incense: ['3307']
};

const GENERIC_TOKENS = new Set([
  'pack',
  'packet',
  'combo',
  'premium',
  'fresh',
  'organic',
  'natural',
  'pure',
  'gm',
  'gms',
  'kg',
  'ml',
  'ltr',
  'litre',
  'gram',
  'grams',
  'the',
  'and',
  'of',
  'with',
  'for',
  'special',
  'homemade',
  'traditional'
]);
