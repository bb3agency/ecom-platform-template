/**
 * Curated HSN-prefix → Indian GST rate rules for the admin product editor's
 * "suggested GST rate" autofill.
 *
 * SOURCE + CURRENCY: hand-curated from the CBIC GST 2.0 rate schedules
 * (Notification No. 9/2025-CT(Rate), effective 22 September 2025, as amended) and
 * their published item-wise summaries. Since GST 2.0 the operative slabs are
 * 0% / 5% / 18% / 40% (12% and 28% were abolished for goods; 3% remains for
 * precious metals/jewellery, and a transitional 28%+cess persists only for a few
 * tobacco items pending cess retirement). There is NO official machine-readable
 * rate feed — CBIC publishes HTML/Gazette PDFs — so this dataset is vendored and
 * updated via core releases, exactly like the WCO HSN dataset (hsn-dataset.ts).
 *
 * SEMANTICS: rules are [hsnPrefix, ratePercent, note?]. Lookup is
 * LONGEST-PREFIX-WINS (see gst-rate-suggest.ts): a 6-digit rule beats a 4-digit
 * heading rule beats a 2-digit chapter default. Rates are SUGGESTIONS ONLY — many
 * GST rates legally hinge on qualifiers the code alone cannot capture
 * (pre-packaged & labelled vs loose, per-piece price bands for apparel/footwear,
 * sugar content for beverages), which is what `note` carries. The admin always
 * confirms; the invoice uses whatever rate the product stores.
 *
 * Coverage is deliberately deepest for chapters 04–24 and 30–34 (food/FMCG —
 * this platform's client base) with chapter-level defaults for the common
 * remainder of retail. Unmatched codes return no suggestion rather than a guess.
 */

export type GstRateRule = readonly [prefix: string, ratePercent: number, note?: string];

const PREPACK = '5% when pre-packaged & labelled; 0% sold loose/unbranded';

export const GST_RATE_RULES: readonly GstRateRule[] = [
  // ---- Chapter 04 — dairy, eggs, honey ----
  ['0401', 0, 'Fresh and UHT milk are GST-exempt'],
  ['0402', 5, 'Concentrated/sweetened milk (condensed milk, khoya)'],
  ['0403', 0, 'Curd, lassi, buttermilk and plain yogurt are exempt (incl. pre-packaged, GST 2.0)'],
  ['0404', 5],
  ['0405', 5, 'Butter, ghee, dairy spreads'],
  ['0406', 5, 'Cheese'],
  ['040610', 0, 'Fresh cheese incl. paneer/chena is exempt (GST 2.0)'],
  ['0407', 0, 'Eggs in shell are exempt'],
  ['0409', 5, 'Natural honey — 0% when sold loose (not pre-packaged & labelled)'],
  // ---- Chapters 07-08 — vegetables, nuts, fruit ----
  ['07', 0, 'Fresh/chilled vegetables are exempt'],
  ['0712', 5, 'Dried vegetables — ' + PREPACK],
  ['0713', 5, 'Dried pulses/dal — ' + PREPACK],
  ['08', 0, 'Fresh fruit is exempt'],
  ['0801', 5, 'Coconut, Brazil nuts, cashew (fresh or dried)'],
  ['0802', 5, 'Almonds, walnuts, pistachios and other nuts'],
  ['0804', 5, 'Dates, figs — dried; fresh mostly exempt'],
  ['0806', 5, 'Raisins (dried grapes); fresh grapes exempt'],
  ['0813', 5, 'Mixed dried fruit'],
  // ---- Chapter 09 — coffee, tea, spices ----
  ['0901', 5, 'Coffee, roasted or ground (instant coffee under 2101 is 18%)'],
  ['0902', 5, 'Tea — unprocessed green leaf is exempt'],
  ['0904', 5, 'Pepper and chillies (dried/crushed)'],
  ['0905', 5],
  ['0906', 5],
  ['0907', 5],
  ['0908', 5, 'Nutmeg, cardamom'],
  ['0909', 5, 'Cumin, coriander, fennel seeds'],
  ['0910', 5, 'Ginger, turmeric, curry and spice mixes'],
  // ---- Chapters 10-12 — cereals, milling, oil seeds ----
  ['10', 5, 'Cereals — ' + PREPACK],
  ['1006', 5, 'Rice — ' + PREPACK],
  ['11', 5, 'Flours/milling products — ' + PREPACK],
  ['1202', 5, 'Groundnuts'],
  ['1207', 5, 'Sesame (til) and other oil seeds'],
  // ---- Chapter 15 — edible oils ----
  ['15', 5, 'Edible vegetable oils (groundnut, mustard, coconut, sunflower…)'],
  // ---- Chapters 16-21 — prepared foods ----
  ['16', 5, 'Prepared meat/fish products'],
  ['1701', 5, 'Cane/beet sugar, jaggery (gur), khandsari'],
  ['1702', 5, 'Other sugars incl. palm jaggery'],
  ['1704', 5, 'Sugar confectionery, mishri, gajak'],
  ['18', 5, 'Cocoa and chocolate (GST 2.0 moved chocolates 18% → 5%)'],
  ['19', 5],
  ['1904', 5, 'Poha, muesli, cornflakes and cereal preparations'],
  ['1905', 5, 'Biscuits, cakes, rusks — plain bread and Indian breads (roti/paratha) are exempt'],
  ['2001', 5, 'Pickles and vegetables preserved in vinegar'],
  ['2002', 5],
  ['2005', 5],
  ['2006', 5],
  ['2007', 5, 'Jams, fruit jellies, marmalades'],
  ['2008', 5, 'Prepared/roasted nuts, chikki-style preparations'],
  ['2009', 5, 'Fruit and vegetable juices (non-carbonated)'],
  ['2101', 18, 'Instant coffee, coffee/tea extracts'],
  ['2103', 5, 'Sauces, chutneys, mixed condiments and masala pastes'],
  ['2105', 5, 'Ice cream (GST 2.0 moved 18% → 5%)'],
  ['2106', 5, 'Misc. edible preparations — namkeen, bhujia, mixtures, sweets/mithai'],
  // ---- Chapter 22 — beverages ----
  ['2201', 0, 'Plain/mineral water, unsweetened'],
  ['2202', 40, 'Aerated/carbonated and caffeinated drinks are 40% — fruit-pulp based drinks are 5%'],
  ['220299', 5, 'Non-carbonated fruit-pulp/juice based drinks'],
  // ---- Chapter 23 — animal feed ----
  ['2309', 5, 'Prepared pet/animal feed'],
  // ---- Chapter 24 — tobacco (demerit) ----
  ['24', 40, 'Tobacco/pan masala — demerit rate (some items transitional 28% + cess until cess retirement)'],
  // ---- Chapter 25 — salt ----
  ['2501', 0, 'Salt is exempt'],
  // ---- Chapter 30 — pharma ----
  ['30', 5, 'Most medicines are 5%; specified life-saving drugs are exempt'],
  // ---- Chapter 33-34 — toiletries, soaps ----
  ['33', 18, 'Cosmetics/perfumery default'],
  ['3305', 5, 'Hair oil and shampoo (GST 2.0 moved 18% → 5%)'],
  ['3306', 5, 'Toothpaste and oral care'],
  ['3307', 5, 'Agarbatti/incense, shaving preparations'],
  ['34', 18],
  ['3401', 5, 'Toilet soap and bathing bars (GST 2.0 moved 18% → 5%)'],
  ['3402', 18, 'Detergents and washing preparations'],
  ['3406', 18, 'Candles'],
  // ---- Chapters 39-49 — plastics, leather, wood, paper, books ----
  ['3924', 18, 'Plastic tableware/kitchenware/household articles'],
  ['42', 18, 'Leather goods/handbags'],
  ['4419', 5, 'Wooden tableware and kitchenware'],
  ['48', 18],
  ['4818', 18, 'Tissues, napkins'],
  ['4820', 0, 'Exercise/note books are exempt (GST 2.0)'],
  ['4901', 0, 'Printed books are exempt'],
  ['4902', 0, 'Newspapers and journals are exempt'],
  // ---- Chapters 52-64 — textiles, apparel, footwear ----
  ['52', 5, 'Cotton and cotton fabrics'],
  ['61', 5, 'Apparel — 18% when sale value exceeds ₹2,500 per piece'],
  ['62', 5, 'Apparel — 18% when sale value exceeds ₹2,500 per piece'],
  ['63', 5, 'Made-up textiles (bed/table linen) — 18% above the per-piece price band'],
  ['64', 5, 'Footwear — 18% when sale value exceeds ₹2,500 per pair'],
  // ---- Chapters 69-71 — ceramics, glass, jewellery ----
  ['6912', 5, 'Clay/earthen and ceramic tableware'],
  ['70', 18],
  ['7013', 18, 'Glassware'],
  ['7108', 3, 'Gold — precious-metal slab (unchanged by GST 2.0)'],
  ['7113', 3, 'Jewellery of precious metal — 3% (making charges 5%)'],
  // ---- Chapters 73-85 — metalware, appliances, electronics ----
  ['7323', 5, 'Iron/steel kitchenware and household articles (GST 2.0 moved 12% → 5%)'],
  ['7418', 5, 'Copper/brass household articles'],
  ['7615', 5, 'Aluminium kitchenware'],
  ['84', 18, 'Machinery/appliances default (ACs and large appliances moved 28% → 18%)'],
  ['85', 18, 'Electronics default — mobiles, TVs 18%'],
  // ---- Chapters 94-96 — furniture, toys, misc ----
  ['94', 18, 'Furniture, lamps'],
  ['9503', 5, 'Toys other than electronic — electronic toys are 18%'],
  ['9603', 5, 'Brooms and brushes'],
  ['9619', 0, 'Sanitary pads/tampons are exempt']
];
