import { describe, expect, it } from 'vitest';
import {
  classifyInterStateSupply,
  resolveGstStateByName,
  resolveGstStatesForPincode,
  resolveSupplySideState
} from '@common/gst/pincode-state';

describe('resolveGstStatesForPincode', () => {
  it('maps unambiguous metro pincodes to their state', () => {
    expect(resolveGstStatesForPincode('110001')).toEqual([{ code: '07', name: 'Delhi' }]);
    expect(resolveGstStatesForPincode('400001')).toEqual([{ code: '27', name: 'Maharashtra' }]);
    expect(resolveGstStatesForPincode('500001')).toEqual([{ code: '36', name: 'Telangana' }]);
    expect(resolveGstStatesForPincode('560001')).toEqual([{ code: '29', name: 'Karnataka' }]);
    expect(resolveGstStatesForPincode('600001')).toEqual([{ code: '33', name: 'Tamil Nadu' }]);
    expect(resolveGstStatesForPincode('700001')).toEqual([{ code: '19', name: 'West Bengal' }]);
  });

  it('separates Telangana from Andhra Pradesh post-bifurcation', () => {
    expect(resolveGstStatesForPincode('509001')).toEqual([{ code: '36', name: 'Telangana' }]);
    expect(resolveGstStatesForPincode('522001')).toEqual([{ code: '37', name: 'Andhra Pradesh' }]);
  });

  it('resolves enclave prefixes carved out of a surrounding range', () => {
    // Goa inside Maharashtra's zone; Sikkim + A&N inside West Bengal's zone.
    expect(resolveGstStatesForPincode('403001')).toEqual([{ code: '30', name: 'Goa' }]);
    expect(resolveGstStatesForPincode('737101')).toEqual([{ code: '11', name: 'Sikkim' }]);
    expect(resolveGstStatesForPincode('744101')).toEqual([
      { code: '35', name: 'Andaman and Nicobar Islands' }
    ]);
  });

  it('returns dominant-first candidate lists for genuinely shared prefixes', () => {
    expect(resolveGstStatesForPincode('682001').map((s) => s.name)).toEqual([
      'Kerala',
      'Lakshadweep'
    ]);
    expect(resolveGstStatesForPincode('244001').map((s) => s.name)).toEqual([
      'Uttar Pradesh',
      'Uttarakhand'
    ]);
    expect(resolveGstStatesForPincode('396001').map((s) => s.name)).toEqual([
      'Gujarat',
      'Dadra and Nagar Haveli and Daman and Diu'
    ]);
  });

  it('rejects malformed pincodes', () => {
    expect(resolveGstStatesForPincode('01234')).toEqual([]);
    expect(resolveGstStatesForPincode('0500011')).toEqual([]);
    expect(resolveGstStatesForPincode('50000a')).toEqual([]);
    expect(resolveGstStatesForPincode('')).toEqual([]);
    expect(resolveGstStatesForPincode(null)).toEqual([]);
  });
});

describe('resolveGstStateByName', () => {
  it('normalises abbreviations, spellings, and old names', () => {
    expect(resolveGstStateByName('TS')?.name).toBe('Telangana');
    expect(resolveGstStateByName('Tamil Nadu')?.code).toBe('33');
    expect(resolveGstStateByName('tamilnadu')?.code).toBe('33');
    expect(resolveGstStateByName('Pondicherry')?.name).toBe('Puducherry');
    expect(resolveGstStateByName('Orissa')?.name).toBe('Odisha');
    expect(resolveGstStateByName('Chattisgarh')?.name).toBe('Chhattisgarh');
    expect(resolveGstStateByName('  a.p. ')?.name).toBe('Andhra Pradesh');
  });

  it('returns null for unknown text', () => {
    expect(resolveGstStateByName('Hyderabad')).toBeNull();
    expect(resolveGstStateByName('')).toBeNull();
    expect(resolveGstStateByName(undefined)).toBeNull();
  });
});

describe('resolveSupplySideState', () => {
  it('lets the pincode win over a mistyped state name', () => {
    expect(
      resolveSupplySideState({ pincode: '500032', stateName: 'Andhra Pradesh' })?.name
    ).toBe('Telangana');
  });

  it('uses the typed state to disambiguate a shared prefix', () => {
    expect(
      resolveSupplySideState({ pincode: '682555', stateName: 'Lakshadweep' })?.name
    ).toBe('Lakshadweep');
    expect(resolveSupplySideState({ pincode: '682001', stateName: 'Kerala' })?.name).toBe(
      'Kerala'
    );
    // No usable typed state → dominant candidate.
    expect(resolveSupplySideState({ pincode: '682020', stateName: '' })?.name).toBe('Kerala');
  });

  it('falls back to the typed name when the pincode is unusable', () => {
    expect(resolveSupplySideState({ pincode: 'nope', stateName: 'Goa' })?.name).toBe('Goa');
    expect(resolveSupplySideState({ pincode: null, stateName: null })).toBeNull();
  });
});

describe('classifyInterStateSupply', () => {
  it('classifies same-state supply as intra-state (CGST+SGST)', () => {
    const result = classifyInterStateSupply({
      seller: { pincode: '500001', stateName: 'Telangana' },
      buyer: { pincode: '500090', stateName: '' }
    });
    expect(result.isInterState).toBe(false);
    expect(result.basis).toBe('resolved');
  });

  it('classifies cross-state supply as inter-state (IGST)', () => {
    const result = classifyInterStateSupply({
      seller: { pincode: '500001', stateName: 'Telangana' },
      buyer: { pincode: '560037', stateName: '' }
    });
    expect(result.isInterState).toBe(true);
    expect(result.buyerState?.name).toBe('Karnataka');
  });

  it('survives mismatched spellings that broke the raw string compare', () => {
    // "TS" vs "Telangana" used to classify as inter-state; pincodes fix it.
    const result = classifyInterStateSupply({
      seller: { pincode: null, stateName: 'TS' },
      buyer: { pincode: '500090', stateName: 'Telangana' }
    });
    expect(result.isInterState).toBe(false);
    expect(result.basis).toBe('resolved');
  });

  it('falls back to the legacy raw string compare when nothing maps', () => {
    const same = classifyInterStateSupply({
      seller: { pincode: null, stateName: 'Somewhere' },
      buyer: { pincode: null, stateName: 'somewhere ' }
    });
    expect(same.isInterState).toBe(false);
    expect(same.basis).toBe('fallback-state-name');

    const missing = classifyInterStateSupply({
      seller: { pincode: null, stateName: 'Somewhere' },
      buyer: { pincode: null, stateName: '' }
    });
    expect(missing.isInterState).toBe(true);
  });

  it('treats bifurcated neighbours as inter-state', () => {
    const result = classifyInterStateSupply({
      seller: { pincode: '500001', stateName: '' },
      buyer: { pincode: '522510', stateName: '' }
    });
    expect(result.isInterState).toBe(true);
    expect(result.sellerState?.name).toBe('Telangana');
    expect(result.buyerState?.name).toBe('Andhra Pradesh');
  });
});
