import { describe, expect, it } from 'vitest';
import {
  MORTGAGE_BASKETS,
  MORTGAGE_LTV_CAPS,
  calculateMortgage,
  mortgagePresetTracks,
  mortgageSensitivity,
  type MortgageInput,
  type MortgageTrackInput,
} from './mortgage.js';

function input(overrides: Partial<MortgageInput> = {}, tracks?: MortgageTrackInput[]): MortgageInput {
  return {
    propertyPrice: 2_000_000,
    downPayment: 1_000_000,
    buyerType: 'first',
    repayment: 'spitzer',
    cpiRate: 0,
    boiRate: 0.0325,
    tracks: tracks ?? [{ type: 'fixedUnlinked', share: 1, rate: 0.05, years: 25 }],
    ...overrides,
  };
}

describe('calculateMortgage', () => {
  it('prices ₪1,000,000 at 5% over 25 years Spitzer at ₪5,845.90', () => {
    const result = calculateMortgage(input());

    expect(result.loanAmount).toBe(1_000_000);
    expect(result.firstPayment).toBeCloseTo(5_845.9, 2);
    expect(result.months).toHaveLength(300);
  });

  it('starts equal principal at ₪7,500', () => {
    const result = calculateMortgage(input({ repayment: 'equalPrincipal' }));

    expect(result.firstPayment).toBeCloseTo(7_500, 6);
    expect(result.peakPayment).toBeCloseTo(7_500, 6);
  });

  it('runs a linked track identically to an unlinked one when CPI is zero', () => {
    const unlinked = calculateMortgage(input({}, [{ type: 'variable5Unlinked', share: 1, rate: 0.04, years: 20 }]));
    const linked = calculateMortgage(input({}, [{ type: 'fixedLinked', share: 1, rate: 0.04, years: 20 }]));

    expect(linked.nominal.total).toBeCloseTo(unlinked.nominal.total, 6);
    expect(linked.nominal.indexation).toBe(0);
  });

  it('reconciles a linked track: nominal = principal + interest + indexation, today = real schedule', () => {
    const real = calculateMortgage(input({}, [{ type: 'fixedLinked', share: 1, rate: 0.035, years: 25 }]));
    const linked = calculateMortgage(input({ cpiRate: 0.03 }, [{ type: 'fixedLinked', share: 1, rate: 0.035, years: 25 }]));

    expect(linked.nominal.total)
      .toBeCloseTo(linked.loanAmount + linked.nominal.interest + linked.nominal.indexation, 4);
    expect(linked.today.total).toBeCloseTo(real.nominal.total, 4);
    expect(linked.today.total).toBeLessThan(linked.nominal.total);
    expect(linked.peakPayment).toBeGreaterThan(linked.firstPayment);
    expect(linked.peakMonth).toBe(300);
  });

  it('clears every track to a zero balance', () => {
    const result = calculateMortgage(input({ cpiRate: 0.025 }, mortgagePresetTracks('thirds', 30)));

    expect(result.years.at(-1)?.closingBalance).toBeCloseTo(0, 6);
    expect(result.months.at(-1)?.balance).toBeCloseTo(0, 6);
  });

  it('handles a zero rate and deflation without NaN', () => {
    const zero = calculateMortgage(input({}, [{ type: 'fixedUnlinked', share: 1, rate: 0, years: 10 }]));
    const deflation = calculateMortgage(input({ cpiRate: -0.01 }, [{ type: 'fixedLinked', share: 1, rate: 0.03, years: 10 }]));

    expect(zero.firstPayment).toBeCloseTo(1_000_000 / 120, 6);
    expect(zero.nominal.total).toBeCloseTo(1_000_000, 6);
    expect(deflation.nominal.indexation).toBeLessThan(0);
    expect(Number.isFinite(deflation.today.total)).toBe(true);
    expect(deflation.months.at(-1)?.balance).toBeCloseTo(0, 6);
  });

  it('prices prime as the policy rate plus 1.5 plus the spread', () => {
    const result = calculateMortgage(input({}, [{ type: 'prime', share: 1, rate: -0.005, years: 25 }]));

    expect(result.tracks[0].annualRate).toBeCloseTo(0.0425, 10);
  });

  it.each(MORTGAGE_BASKETS)('raises no rule notice for the %s basket', (basket) => {
    const result = calculateMortgage(input({}, mortgagePresetTracks(basket, 25)));

    expect(result.notices).toEqual([]);
  });

  it('fires the fixed-third notice just below a third, not at it', () => {
    const at = calculateMortgage(input({}, [
      { type: 'fixedLinked', share: 1 / 3, years: 25 },
      { type: 'prime', share: 2 / 3, years: 25 },
    ]));
    const below = calculateMortgage(input({}, [
      { type: 'fixedLinked', share: 0.32, years: 25 },
      { type: 'prime', share: 0.68, years: 25 },
    ]));

    expect(at.notices.map(({ code }) => code)).not.toContain('fixedShareBelowThird');
    expect(below.notices.map(({ code }) => code)).toContain('fixedShareBelowThird');
  });

  it('fires the LTV notice above the buyer type cap only', () => {
    const atCap = calculateMortgage(input({ downPayment: 2_000_000 * (1 - MORTGAGE_LTV_CAPS.first) }));
    const aboveCap = calculateMortgage(input({ downPayment: 2_000_000 * (1 - MORTGAGE_LTV_CAPS.first) - 1_000 }));
    const investor = calculateMortgage(input({ buyerType: 'investor', downPayment: 900_000 }));

    expect(atCap.notices).toEqual([]);
    expect(aboveCap.notices.map(({ code }) => code)).toEqual(['ltvAboveCap']);
    expect(investor.notices.map(({ code }) => code)).toEqual(['ltvAboveCap']);
    expect(atCap.minimumDownPayment).toBeCloseTo(500_000, 6);
  });

  it('fires the payment-to-income notice above 40%', () => {
    const payment = calculateMortgage(input()).firstPayment;
    const at = calculateMortgage(input({ monthlyNetIncome: payment / 0.4 }));
    const above = calculateMortgage(input({ monthlyNetIncome: payment / 0.41 }));
    const prohibited = calculateMortgage(input({ monthlyNetIncome: payment / 0.55 }));

    expect(at.notices).toEqual([]);
    expect(above.notices).toEqual([expect.objectContaining({ code: 'paymentToIncomeAboveCeiling', prohibited: false })]);
    expect(prohibited.notices).toEqual([expect.objectContaining({ prohibited: true })]);
  });

  it('fires the term notice above 30 years and the shares notice off 100%', () => {
    const term = calculateMortgage(input({}, [{ type: 'fixedUnlinked', share: 1, years: 31 }]));
    const shares = calculateMortgage(input({}, [{ type: 'fixedUnlinked', share: 0.9, years: 25 }]));

    expect(term.notices.map(({ code }) => code)).toEqual(['termAboveMax']);
    expect(shares.notices.map(({ code }) => code)).toEqual(['sharesNotHundred']);
  });

  it('owes nothing when the down payment covers the price', () => {
    const result = calculateMortgage(input({ downPayment: 2_000_000 }));

    expect(result.loanAmount).toBe(0);
    expect(result.firstPayment).toBe(0);
    expect(result.notices).toEqual([]);
  });
});

describe('mortgageSensitivity', () => {
  it('moves prime and variable tracks with the policy rate, and leaves fixed ones', () => {
    const fixed = input({}, [{ type: 'fixedUnlinked', share: 1, rate: 0.05, years: 25 }]);
    const mixed = input({}, mortgagePresetTracks('thirds', 25));

    expect(mortgageSensitivity(fixed).boiPlus2.firstPayment).toBeCloseTo(calculateMortgage(fixed).firstPayment, 6);
    const base = calculateMortgage(mixed).firstPayment;
    const sensitivity = mortgageSensitivity(mixed);
    expect(sensitivity.boiPlus1.firstPayment).toBeGreaterThan(base);
    expect(sensitivity.boiPlus2.firstPayment).toBeGreaterThan(sensitivity.boiPlus1.firstPayment);
    expect(sensitivity.cpi4.peakPayment).toBeGreaterThan(calculateMortgage(mixed).peakPayment);
  });
});
