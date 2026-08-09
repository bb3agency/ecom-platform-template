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
      // Tokens are matched singular/plural-insensitively ("laddus" hits "laddu"),
      // and a lone token may PREFIX-match an alias key ("cardam" → cardamom) so
      // suggestions work while the admin is still typing.
      const aliasPrefixes = resolveAliasPrefixes(token, tokens.length === 1);
      if (aliasPrefixes?.some((prefix) => code.startsWith(prefix))) {
        matched += 1;
        score += 5;
        continue;
      }
      const at = matchTokenInDescription(desc, token);
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

/** Cheap singular form: "laddus" → "laddu", "pickles" → "pickle", "spices" → "spice". */
function singularize(token: string): string {
  if (token.length > 3 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('es') && !token.endsWith('ees')) return token.slice(0, -1);
  if (token.length > 2 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/**
 * Resolve a query token to alias HS prefixes: exact key first, then the singular
 * form, then — only for a single-token query of 3+ chars — a unique key-prefix
 * match so half-typed terms ("cardam", "jagg") already suggest. Multi-token
 * queries skip prefix matching to avoid noise ("mix" would hit "mixture").
 */
function resolveAliasPrefixes(token: string, allowPrefix: boolean): string[] | undefined {
  const direct = INDIAN_TERM_TO_HS[token] ?? INDIAN_TERM_TO_HS[singularize(token)];
  if (direct) return direct;
  if (!allowPrefix || token.length < 3) return undefined;
  const keys = Object.keys(INDIAN_TERM_TO_HS).filter((key) => key.startsWith(token));
  if (keys.length === 0) return undefined;
  const merged = new Set<string>();
  for (const key of keys) {
    for (const prefix of INDIAN_TERM_TO_HS[key] ?? []) merged.add(prefix);
  }
  return [...merged];
}

/** indexOf that also tries the singular form ("chillies" matches "chilli"). */
function matchTokenInDescription(desc: string, token: string): number {
  const at = desc.indexOf(token);
  if (at !== -1) return at;
  const singular = singularize(token);
  return singular === token ? -1 : desc.indexOf(singular);
}

/**
 * Common Indian trade/product terms → HS code prefixes. The WCO nomenclature uses
 * international wording ("fats and oils derived from milk", not "ghee"), so these
 * aliases are what make suggestions work for Indian storefronts. Prefixes, not exact
 * codes — all matching subheadings surface and the specific ones rank first.
 * Keep keys SINGULAR — plural queries are singularized before lookup.
 */
const INDIAN_TERM_TO_HS: Record<string, string[]> = {
  // Dairy
  ghee: ['0405'],
  butter: ['0405'],
  makhan: ['0405'],
  paneer: ['040610'],
  chena: ['040610'],
  cheese: ['0406'],
  curd: ['0403'],
  dahi: ['0403'],
  yogurt: ['0403'],
  yoghurt: ['0403'],
  lassi: ['0403'],
  buttermilk: ['0403'],
  chaas: ['0403'],
  milk: ['0401', '0402'],
  khoya: ['0402'],
  khova: ['0402'],
  mawa: ['0402'],
  condensed: ['0402'],
  honey: ['0409'],
  egg: ['0407'],
  // Sweeteners
  jaggery: ['1701'],
  gur: ['1701'],
  bellam: ['1701'],
  sugar: ['1701'],
  mishri: ['1704'],
  khandsari: ['1701'],
  // Grains, flours, milling
  atta: ['1101'],
  maida: ['1101'],
  flour: ['1101', '1102', '1106'],
  besan: ['1106'],
  sooji: ['1103'],
  suji: ['1103'],
  rava: ['1103'],
  semolina: ['1103'],
  rice: ['1006'],
  basmati: ['1006'],
  poha: ['1904'],
  aval: ['1904'],
  atukulu: ['1904'],
  murmura: ['1904'],
  puffed: ['1904'],
  wheat: ['1001'],
  millet: ['1008'],
  ragi: ['1008'],
  jowar: ['1007'],
  bajra: ['1008'],
  quinoa: ['1008'],
  oats: ['1004', '1904'],
  // Pulses
  dal: ['0713'],
  dhal: ['0713'],
  lentil: ['0713'],
  pulse: ['0713'],
  chana: ['0713'],
  chickpea: ['0713'],
  rajma: ['0713'],
  moong: ['0713'],
  toor: ['0713'],
  urad: ['0713'],
  masoor: ['0713'],
  // Spices & condiments
  turmeric: ['091030'],
  haldi: ['091030'],
  pasupu: ['091030'],
  chilli: ['0904'],
  chili: ['0904'],
  mirchi: ['0904'],
  kaaram: ['0904'],
  karam: ['0904'],
  pepper: ['0904'],
  paprika: ['0904'],
  cardamom: ['0908'],
  elaichi: ['0908'],
  nutmeg: ['0908'],
  jaiphal: ['0908'],
  clove: ['0907'],
  laung: ['0907'],
  cinnamon: ['0906'],
  dalchini: ['0906'],
  vanilla: ['0905'],
  cumin: ['0909'],
  jeera: ['0909'],
  fennel: ['0909'],
  saunf: ['0909'],
  ajwain: ['0909'],
  coriander: ['0909'],
  dhania: ['0909'],
  fenugreek: ['0910'],
  methi: ['0910'],
  ginger: ['0910'],
  adrak: ['0910'],
  saffron: ['0910'],
  kesar: ['0910'],
  garlic: ['0703'],
  onion: ['0703'],
  masala: ['0910', '2103'],
  spice: ['0910'],
  podi: ['0910'],
  hing: ['1301'],
  asafoetida: ['1301'],
  chutney: ['2103'],
  sauce: ['2103'],
  ketchup: ['2103'],
  vinegar: ['2209'],
  // Pickles & preserves
  pickle: ['2001'],
  achar: ['2001'],
  avakaya: ['2001'],
  jam: ['2007'],
  marmalade: ['2007'],
  murabba: ['2007'],
  // Bakery & snacks
  papad: ['1905'],
  appalam: ['1905'],
  biscuit: ['1905'],
  cookie: ['1905'],
  bread: ['1905'],
  cake: ['1905'],
  pastry: ['1905'],
  rusk: ['1905'],
  toast: ['1905'],
  khari: ['1905'],
  murukku: ['1905'],
  chakli: ['1905'],
  chakodi: ['1905'],
  wafer: ['1905'],
  namkeen: ['2106'],
  bhujia: ['2106'],
  sev: ['2106'],
  chivda: ['2106'],
  chudva: ['2106'],
  farsan: ['2106'],
  snack: ['2106', '1905'],
  mixture: ['2106'],
  chips: ['2008', '1905'],
  noodle: ['1902'],
  pasta: ['1902'],
  macaroni: ['1902'],
  vermicelli: ['1902'],
  semiya: ['1902'],
  cornflake: ['1904'],
  muesli: ['1904'],
  cereal: ['1904'],
  // Sweets
  sweet: ['2106', '1704'],
  mithai: ['2106'],
  laddu: ['2106'],
  ladoo: ['2106'],
  laddoo: ['2106'],
  halwa: ['2106'],
  burfi: ['2106'],
  barfi: ['2106'],
  peda: ['2106'],
  jalebi: ['2106'],
  mysorepak: ['2106'],
  soan: ['2106'],
  papdi: ['2106'],
  chikki: ['2008', '1704'],
  candy: ['1704'],
  toffee: ['1704'],
  confectionery: ['1704'],
  chocolate: ['1806'],
  cocoa: ['1806'],
  gulab: ['2106'],
  jamun: ['2106'],
  rasgulla: ['2106'],
  kalakand: ['2106'],
  // Beverages
  tea: ['0902'],
  chai: ['0902'],
  coffee: ['0901'],
  juice: ['2009'],
  squash: ['2009', '2106'],
  sherbet: ['2106'],
  sharbat: ['2106'],
  water: ['2201'],
  soda: ['2202'],
  // Dry fruits, nuts & seeds
  cashew: ['0801'],
  kaju: ['0801'],
  coconut: ['0801', '1513'],
  copra: ['1203'],
  almond: ['0802'],
  badam: ['0802'],
  walnut: ['0802'],
  akhrot: ['0802'],
  pista: ['0802'],
  pistachio: ['0802'],
  fig: ['0804'],
  anjeer: ['0804'],
  date: ['0804'],
  khajur: ['0804'],
  raisin: ['0806'],
  kismis: ['0806'],
  kishmish: ['0806'],
  apricot: ['0813'],
  dryfruit: ['0813', '0801', '0802'],
  peanut: ['1202', '2008'],
  groundnut: ['1202', '2008'],
  sesame: ['1207'],
  til: ['1207'],
  nuvvulu: ['1207'],
  flaxseed: ['1204'],
  alsi: ['1204'],
  chia: ['1207'],
  makhana: ['0813', '2008'],
  // Oils
  oil: ['15'],
  sunflower: ['1512'],
  mustard: ['1514', '0910'],
  groundnutoil: ['1508'],
  gingelly: ['1515'],
  // Eggs/meat/fish
  chicken: ['0207', '1602'],
  mutton: ['0204'],
  fish: ['03', '1604'],
  prawn: ['0306'],
  // Household & personal care
  soap: ['3401'],
  handwash: ['3401'],
  detergent: ['3402'],
  shampoo: ['3305'],
  conditioner: ['3305'],
  hairoil: ['3305'],
  toothpaste: ['3306'],
  toothbrush: ['9603'],
  cream: ['3304'],
  lotion: ['3304'],
  facewash: ['3304'],
  kumkum: ['3304'],
  kajal: ['3304'],
  perfume: ['3303'],
  attar: ['3303'],
  candle: ['3406'],
  agarbatti: ['3307'],
  agarbathi: ['3307'],
  incense: ['3307'],
  dhoop: ['3307'],
  camphor: ['2914'],
  karpura: ['2914'],
  phenyl: ['3808'],
  // Kitchen & general merchandise
  utensil: ['7323', '7615'],
  steel: ['7323'],
  bottle: ['3923', '7010'],
  jar: ['3923', '7010'],
  towel: ['6302'],
  bedsheet: ['6302'],
  saree: ['6211', '5407'],
  sari: ['6211', '5407'],
  kurta: ['6211'],
  tshirt: ['6109'],
  shirt: ['6205'],
  footwear: ['64'],
  slipper: ['6402'],
  chappal: ['6402'],
  toy: ['9503'],
  book: ['4901'],
  notebook: ['4820'],
  pen: ['9608'],
  pencil: ['9609'],
  broom: ['9603']
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
