/**
 * Filename for a downloaded attachment, taken from the SERVER's
 * `Content-Disposition` header rather than guessed by the caller.
 *
 * Why (2026-08-10): every invoice download built its own filename from the
 * order payload held in React state — `${invoice.invoiceNumber}.pdf`, or
 * `${orderNumber}-invoice.pdf` when the number was not loaded. That copy is
 * stale exactly when it matters:
 *   • first download of an order whose invoice is generated ON DEMAND — state
 *     still has `invoice: null`, so the file was named after the ORDER while
 *     the PDF inside carried the invoice number;
 *   • after an invoice row is deleted and re-issued (numbers change) — state
 *     holds the previous number;
 *   • the order LIST screens never had an invoice number at all and always
 *     used the order-number form.
 * The backend already sends `attachment; filename="INV-2026-00042.pdf"`, so
 * reading it makes the saved file match the document by construction.
 *
 * Requires the header to be readable: same-origin (the storefront proxies
 * `/api/v1`) or `Access-Control-Expose-Headers: Content-Disposition` on
 * cross-origin deployments (set in the backend CORS plugin). Falls back to the
 * caller's name whenever the header is missing or unparseable.
 */
export function resolveDownloadFilename(response: Response, fallback: string): string {
  const header = response.headers.get("content-disposition");
  if (!header) return fallback;

  // RFC 5987 `filename*=UTF-8''name.pdf` wins over the plain form when present.
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i.exec(header);
  if (extended?.[1]) {
    const sanitized = sanitizeFilename(safeDecode(extended[1].trim()));
    if (sanitized) return sanitized;
  }

  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i.exec(header);
  const raw = (plain?.[1] ?? plain?.[2] ?? "").trim();
  return sanitizeFilename(raw) || fallback;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Characters Windows/macOS reject in filenames, plus control characters. */
const UNSAFE_FILENAME_CHARS = new Set(['<', '>', ':', '"', '|', '?', '*']);

/**
 * Never let a server-supplied name escape the download directory or carry
 * characters the OS rejects. Digits, hyphens and dots must survive — they are
 * the invoice number itself.
 */
function sanitizeFilename(value: string): string {
  const base = value.split(/[\\/]/).pop() ?? "";
  let cleaned = "";
  for (const char of base) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || UNSAFE_FILENAME_CHARS.has(char)) continue;
    cleaned += char;
  }
  return cleaned.trim();
}
