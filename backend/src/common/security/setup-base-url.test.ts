import { describe, expect, it } from 'vitest';
import { validateSetupBaseUrl } from './setup-base-url';

describe('validateSetupBaseUrl', () => {
  it('accepts a public HTTPS origin', () => {
    expect(() => validateSetupBaseUrl('https://client.example.com')).not.toThrow();
  });

  it('rejects non-HTTPS URLs', () => {
    expect(() => validateSetupBaseUrl('http://client.example.com')).toThrow(/HTTPS/);
  });

  it('rejects loopback hostnames', () => {
    expect(() => validateSetupBaseUrl('https://127.0.0.1')).toThrow(/not permitted/);
    expect(() => validateSetupBaseUrl('https://localhost')).toThrow(/not permitted/);
  });

  it('rejects private network hostnames', () => {
    expect(() => validateSetupBaseUrl('https://10.0.0.1')).toThrow(/not permitted/);
    expect(() => validateSetupBaseUrl('https://192.168.1.10')).toThrow(/not permitted/);
  });
});
