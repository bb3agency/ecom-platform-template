/**
 * Pincode → Indian state/UT resolution for GST place-of-supply classification.
 *
 * WHY (2026-08-10): intra vs inter-state decides the tax split on every order —
 * CGST+SGST (intra) vs IGST (inter). The previous classifier compared the raw
 * seller/buyer state STRINGS, which breaks the moment a customer types "TS"
 * instead of "Telangana" or misspells "Chhattisgarh". Pincodes are structured
 * data both sides already provide (admin pickup pincode + shipping address
 * pincode), so they are the primary signal; typed state names are the fallback.
 *
 * Mapping model — the industry-standard 3-digit-prefix approach (the first
 * digit is only the postal zone; the first three digits identify the sorting
 * district, which maps to a state): see ClearTax's e-invoicing pincode-state
 * mapping pattern and India Post's PIN structure. A handful of prefixes are
 * genuinely shared across state borders (e.g. 244 UP/Uttarakhand, 682
 * Kerala/Lakshadweep, 396 Gujarat/DNH&DD, 737 is Sikkim inside WB's range) —
 * those resolve to an ORDERED candidate list (dominant state first) and are
 * disambiguated by the typed state name when it matches a candidate.
 *
 * The dataset is vendored (no runtime network calls, same policy as the GST
 * rate dataset) because there is no official machine-readable feed.
 */

/** GST state codes per the GSTN master (first two digits of every GSTIN). */
export type IndianGstState = {
  code: string;
  name: string;
};

const S = {
  JK: { code: '01', name: 'Jammu and Kashmir' },
  HP: { code: '02', name: 'Himachal Pradesh' },
  PB: { code: '03', name: 'Punjab' },
  CH: { code: '04', name: 'Chandigarh' },
  UK: { code: '05', name: 'Uttarakhand' },
  HR: { code: '06', name: 'Haryana' },
  DL: { code: '07', name: 'Delhi' },
  RJ: { code: '08', name: 'Rajasthan' },
  UP: { code: '09', name: 'Uttar Pradesh' },
  BR: { code: '10', name: 'Bihar' },
  SK: { code: '11', name: 'Sikkim' },
  AR: { code: '12', name: 'Arunachal Pradesh' },
  NL: { code: '13', name: 'Nagaland' },
  MN: { code: '14', name: 'Manipur' },
  MZ: { code: '15', name: 'Mizoram' },
  TR: { code: '16', name: 'Tripura' },
  ML: { code: '17', name: 'Meghalaya' },
  AS: { code: '18', name: 'Assam' },
  WB: { code: '19', name: 'West Bengal' },
  JH: { code: '20', name: 'Jharkhand' },
  OD: { code: '21', name: 'Odisha' },
  CG: { code: '22', name: 'Chhattisgarh' },
  MP: { code: '23', name: 'Madhya Pradesh' },
  GJ: { code: '24', name: 'Gujarat' },
  DD: { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  MH: { code: '27', name: 'Maharashtra' },
  KA: { code: '29', name: 'Karnataka' },
  GA: { code: '30', name: 'Goa' },
  LD: { code: '31', name: 'Lakshadweep' },
  KL: { code: '32', name: 'Kerala' },
  TN: { code: '33', name: 'Tamil Nadu' },
  PY: { code: '34', name: 'Puducherry' },
  AN: { code: '35', name: 'Andaman and Nicobar Islands' },
  TS: { code: '36', name: 'Telangana' },
  AP: { code: '37', name: 'Andhra Pradesh' },
  LA: { code: '38', name: 'Ladakh' }
} as const satisfies Record<string, IndianGstState>;

type StateKey = keyof typeof S;

/** Contiguous 3-digit-prefix ranges, applied in order; later OVERRIDES win. */
const PREFIX_RANGES: Array<[start: number, end: number, state: StateKey]> = [
  [110, 110, 'DL'],
  [121, 136, 'HR'],
  [140, 160, 'PB'],
  [171, 177, 'HP'],
  [180, 194, 'JK'],
  [201, 285, 'UP'],
  [301, 345, 'RJ'],
  [360, 396, 'GJ'],
  [400, 445, 'MH'],
  [450, 488, 'MP'],
  [490, 497, 'CG'],
  [500, 509, 'TS'],
  [510, 535, 'AP'],
  [560, 591, 'KA'],
  [600, 643, 'TN'],
  [670, 695, 'KL'],
  [700, 743, 'WB'],
  [751, 770, 'OD'],
  [781, 788, 'AS'],
  [790, 792, 'AR'],
  [793, 794, 'ML'],
  [795, 795, 'MN'],
  [796, 796, 'MZ'],
  [797, 798, 'NL'],
  [799, 799, 'TR'],
  [800, 855, 'BR']
];

/**
 * Prefix-level corrections and genuinely shared prefixes. Arrays are ORDERED:
 * the dominant state (most pincodes under the prefix) comes first and is the
 * answer when the typed state name cannot disambiguate.
 */
const PREFIX_OVERRIDES: Record<number, StateKey | StateKey[]> = {
  // Chandigarh sits inside Punjab's 160 block (Mohali is Punjab 160xxx).
  160: ['CH', 'PB'],
  // Leh/Kargil (Ladakh) carved out of J&K's 194 block in 2019.
  194: ['LA', 'JK'],
  // UP / Uttarakhand share the 244-262 border blocks.
  244: ['UP', 'UK'],
  246: ['UK', 'UP'],
  247: ['UP', 'UK'],
  248: 'UK',
  249: 'UK',
  262: ['UP', 'UK'],
  263: 'UK',
  // Diu (362520+) inside Gujarat's Junagadh block; Daman + Silvassa in 396.
  362: ['GJ', 'DD'],
  396: ['GJ', 'DD'],
  // Goa inside Maharashtra's zone-4 range.
  403: 'GA',
  // Yanam (Puducherry, 533464) inside AP's East Godavari block.
  533: ['AP', 'PY'],
  // Puducherry town vs Villupuram (TN); Cuddalore (TN) vs enclave offices;
  // Karaikal (Puducherry, 609601+) vs Mayiladuthurai (TN).
  605: ['PY', 'TN'],
  607: ['TN', 'PY'],
  609: ['TN', 'PY'],
  // Mahe (Puducherry, 673310) inside Kerala's Kozhikode block.
  673: ['KL', 'PY'],
  // Lakshadweep islands (682551+) routed via Kochi.
  682: ['KL', 'LD'],
  // Sikkim's single prefix inside WB's zone-7 range.
  737: 'SK',
  // Andaman & Nicobar routed via Kolkata.
  744: 'AN',
  // Bihar / Jharkhand interleave across 813-835.
  813: ['BR', 'JH'],
  814: 'JH',
  815: 'JH',
  816: 'JH',
  821: 'BR',
  822: 'JH',
  823: 'BR',
  824: 'BR',
  825: 'JH',
  826: 'JH',
  827: 'JH',
  828: 'JH',
  829: 'JH',
  830: 'JH',
  831: 'JH',
  832: 'JH',
  833: 'JH',
  834: 'JH',
  835: 'JH'
};

const PREFIX_TO_STATES: Map<number, IndianGstState[]> = (() => {
  const map = new Map<number, IndianGstState[]>();
  for (const [start, end, key] of PREFIX_RANGES) {
    for (let prefix = start; prefix <= end; prefix += 1) {
      map.set(prefix, [S[key]]);
    }
  }
  for (const [prefixKey, value] of Object.entries(PREFIX_OVERRIDES)) {
    const keys = Array.isArray(value) ? value : [value];
    map.set(Number(prefixKey), keys.map((key) => S[key]));
  }
  return map;
})();

/**
 * States/UTs a pincode can belong to, dominant first. Empty array when the
 * pincode is not a valid 6-digit Indian PIN or its prefix is unassigned.
 */
export function resolveGstStatesForPincode(pincode: string | null | undefined): IndianGstState[] {
  const trimmed = (pincode ?? '').trim();
  if (!/^[1-9]\d{5}$/.test(trimmed)) return [];
  return PREFIX_TO_STATES.get(Number(trimmed.slice(0, 3))) ?? [];
}

/** Common spellings/abbreviations → canonical state, for typed-state fallback. */
const STATE_NAME_ALIASES: Record<string, StateKey> = {
  jammuandkashmir: 'JK',
  jammukashmir: 'JK',
  jk: 'JK',
  himachalpradesh: 'HP',
  himachal: 'HP',
  hp: 'HP',
  punjab: 'PB',
  pb: 'PB',
  chandigarh: 'CH',
  uttarakhand: 'UK',
  uttaranchal: 'UK',
  uk: 'UK',
  haryana: 'HR',
  hr: 'HR',
  delhi: 'DL',
  newdelhi: 'DL',
  nctofdelhi: 'DL',
  nationalcapitalterritoryofdelhi: 'DL',
  rajasthan: 'RJ',
  rj: 'RJ',
  uttarpradesh: 'UP',
  up: 'UP',
  bihar: 'BR',
  br: 'BR',
  sikkim: 'SK',
  arunachalpradesh: 'AR',
  arunachal: 'AR',
  nagaland: 'NL',
  manipur: 'MN',
  mizoram: 'MZ',
  tripura: 'TR',
  meghalaya: 'ML',
  assam: 'AS',
  westbengal: 'WB',
  wb: 'WB',
  jharkhand: 'JH',
  jh: 'JH',
  odisha: 'OD',
  orissa: 'OD',
  chhattisgarh: 'CG',
  chattisgarh: 'CG',
  chhatisgarh: 'CG',
  cg: 'CG',
  madhyapradesh: 'MP',
  mp: 'MP',
  gujarat: 'GJ',
  gj: 'GJ',
  dadraandnagarhavelianddamananddiu: 'DD',
  dadraandnagarhaveli: 'DD',
  damananddiu: 'DD',
  daman: 'DD',
  diu: 'DD',
  silvassa: 'DD',
  maharashtra: 'MH',
  mh: 'MH',
  karnataka: 'KA',
  ka: 'KA',
  goa: 'GA',
  lakshadweep: 'LD',
  kerala: 'KL',
  kl: 'KL',
  tamilnadu: 'TN',
  tn: 'TN',
  puducherry: 'PY',
  pondicherry: 'PY',
  py: 'PY',
  andamanandnicobarislands: 'AN',
  andamanandnicobar: 'AN',
  andamannicobar: 'AN',
  telangana: 'TS',
  telengana: 'TS',
  ts: 'TS',
  tg: 'TS',
  andhrapradesh: 'AP',
  andhra: 'AP',
  ap: 'AP',
  ladakh: 'LA'
};

/** Canonical state for a free-typed state name/abbreviation, or null. */
export function resolveGstStateByName(name: string | null | undefined): IndianGstState | null {
  const normalized = (name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!normalized) return null;
  const key = STATE_NAME_ALIASES[normalized];
  return key ? S[key] : null;
}

export type SupplySideInput = {
  pincode: string | null | undefined;
  /** Free-typed state name — disambiguates shared prefixes, and is the fallback. */
  stateName: string | null | undefined;
};

/** Best-effort state for one side of the supply: pincode first, typed name second. */
export function resolveSupplySideState(side: SupplySideInput): IndianGstState | null {
  const byPincode = resolveGstStatesForPincode(side.pincode);
  const byName = resolveGstStateByName(side.stateName);
  if (byPincode.length === 1) return byPincode[0]!;
  if (byPincode.length > 1) {
    if (byName && byPincode.some((state) => state.code === byName.code)) return byName;
    return byPincode[0]!;
  }
  return byName;
}

export type InterStateClassification = {
  isInterState: boolean;
  sellerState: IndianGstState | null;
  buyerState: IndianGstState | null;
  /** 'resolved' = both sides mapped via pincode/name; 'fallback-state-name' = legacy raw string compare. */
  basis: 'resolved' | 'fallback-state-name';
};

/**
 * Intra vs inter-state supply for GST: CGST+SGST when the seller (admin pickup
 * pincode) and buyer (shipping address) are in the same state/UT, IGST otherwise.
 * When either side cannot be mapped, falls back to the legacy case-insensitive
 * comparison of the raw typed state names (which yields inter-state on mismatch
 * or missing data — the pre-existing behaviour).
 */
export function classifyInterStateSupply(input: {
  seller: SupplySideInput;
  buyer: SupplySideInput;
}): InterStateClassification {
  const sellerState = resolveSupplySideState(input.seller);
  const buyerState = resolveSupplySideState(input.buyer);
  if (sellerState && buyerState) {
    return {
      isInterState: sellerState.code !== buyerState.code,
      sellerState,
      buyerState,
      basis: 'resolved'
    };
  }
  const sellerRaw = (input.seller.stateName ?? '').trim().toLowerCase();
  const buyerRaw = (input.buyer.stateName ?? '').trim().toLowerCase();
  return {
    isInterState: sellerRaw !== buyerRaw,
    sellerState,
    buyerState,
    basis: 'fallback-state-name'
  };
}
