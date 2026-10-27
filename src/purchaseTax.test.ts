import { describe, expect, it } from 'vitest';
import { PURCHASE_TAX_BRACKETS, purchaseTax } from './purchaseTax.js';

describe('purchaseTax', () => {
  it('exempts a single home up to the first bracket edge', () => {
    expect(purchaseTax(1_978_745, 'singleHome').total).toBe(0);
  });

  it('taxes a single home marginally across brackets', () => {
    const result = purchaseTax(3_000_000, 'singleHome');
    const expected = (2_347_040 - 1_978_745) * 0.035 + (3_000_000 - 2_347_040) * 0.05;

    expect(result.total).toBeCloseTo(expected, 6);
    expect(result.byBracket.map(({ tax }) => tax).reduce((a, b) => a + b, 0)).toBeCloseTo(expected, 6);
  });

  it('taxes an additional home from the first shekel, 10% above the top edge', () => {
    expect(purchaseTax(3_000_000, 'additionalHome').total).toBe(240_000);
    expect(purchaseTax(7_000_000, 'additionalHome').total)
      .toBeCloseTo(6_055_070 * 0.08 + (7_000_000 - 6_055_070) * 0.1, 6);
  });

  it('reads its edges from the frozen table', () => {
    const top = PURCHASE_TAX_BRACKETS.singleHome[3].upTo;
    const below = purchaseTax(top, 'singleHome').total;
    const above = purchaseTax(top + 1_000, 'singleHome').total;

    expect(above - below).toBeCloseTo(100, 6);
  });

  it('treats a non-finite or negative price as zero', () => {
    expect(purchaseTax(Number.NaN, 'singleHome').total).toBe(0);
    expect(purchaseTax(-5, 'additionalHome').total).toBe(0);
  });
});
