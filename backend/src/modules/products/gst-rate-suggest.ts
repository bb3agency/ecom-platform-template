import { GST_RATE_RULES } from './gst-rate-dataset';

export type GstRateSuggestion = {
  ratePercent: number;
  /** Qualifier the code alone cannot capture (pre-packaged vs loose, price bands…). */
  note: string | null;
  /** The dataset prefix that matched — longer = more specific = more reliable. */
  matchedPrefix: string;
};

/**
 * Longest-prefix lookup of the vendored CBIC GST 2.0 rate rules
 * (gst-rate-dataset.ts) powering the "suggested GST rate" autofill in the admin
 * product editor. Pure in-memory, deterministic, works offline — same design as
 * the HSN suggestions. Returns null when no rule covers the code: no suggestion
 * is better than a wrong guess on a tax field.
 */
export function suggestGstRateForHsn(hsnCode: string): GstRateSuggestion | null {
  const code = hsnCode.trim();
  if (!/^\d{2,15}$/.test(code)) return null;

  let best: { prefix: string; rate: number; note: string | undefined } | null = null;
  for (const [prefix, rate, note] of GST_RATE_RULES) {
    if (!code.startsWith(prefix)) continue;
    if (!best || prefix.length > best.prefix.length) {
      best = { prefix, rate, note };
    }
  }
  if (!best) return null;
  return { ratePercent: best.rate, note: best.note ?? null, matchedPrefix: best.prefix };
}
