/**
 * CSV cell escaping with spreadsheet formula-injection neutralisation (OWASP "CSV Injection").
 *
 * Excel / Sheets / LibreOffice evaluate a cell that starts with `=`, `+`, `-`, `@`, TAB or CR
 * as a formula, so customer-controlled text (names, emails) in an admin export could run
 * `=HYPERLINK(...)` / DDE payloads when a merchant opens the file. Such cells are prefixed
 * with a single quote so they render as literal text. Plain numbers (e.g. `-1500`) are left
 * alone so numeric columns stay numeric.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function escapeCsvCell(value: string): string {
  const neutralised = FORMULA_TRIGGER.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  return `"${neutralised.replace(/"/g, '""')}"`;
}
