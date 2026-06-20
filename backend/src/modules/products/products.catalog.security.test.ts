import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('Public catalogue schema (no internal cost leaks)', () => {
  it('list product JSON schema does not define internal-only cost fields', () => {
    const schemaPath = join(__dirname, 'products.schemas.ts');
    const text = readFileSync(schemaPath, 'utf8');
    expect(text.toLowerCase()).not.toContain('costprice');
    expect(text.toLowerCase()).not.toContain('landedcost');
    expect(text.toLowerCase()).not.toContain('marginpercent');
  });
});
