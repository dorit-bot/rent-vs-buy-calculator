import { describe, expect, it } from 'vitest';
import { purchaseTax } from './purchaseTax.js';
import {
  ISRAEL_VAT_RATE,
  RENT_VS_BUY_DEFAULTS,
  RENT_VS_BUY_RETURN_SCENARIOS,
  REAL_GAIN_TAX_RATE,
  SINGLE_HOME_SHEVACH_EXEMPTION_CEILING,
  calculateRentVsBuy,
  rentVsBuyMortgage,
  shevachTax,
  type RentVsBuyInput,
} from './rentVsBuy.js';

function input(overrides: {
  buying?: Partial<RentVsBuyInput['buying']>;
  renting?: Partial<RentVsBuyInput['renting']>;
  shared?: Partial<RentVsBuyInput['shared']>;
} = {}): RentVsBuyInput {
  return {
    buying: { ...RENT_VS_BUY_DEFAULTS.buying, ...overrides.buying },
    renting: { ...RENT_VS_BUY_DEFAULTS.renting, ...overrides.renting },
    shared: { ...RENT_VS_BUY_DEFAULTS.shared, ...overrides.shared },
  };
}

// An all-cash purchase with no costs, a home that appreciates exactly like the portfolio, and
// inflation equal to both — so neither side has a taxable real gain and nothing separates them.
const SYMMETRIC = input({
  buying: {
    price: 1_500_000,
    downPaymentShare: 1,
    lawyerShare: 0,
    ownershipCostShare: 0,
    appreciation: 0.03,
    monthlyInsurance: 0,
    purchaseBrokerShare: 0,
    saleBrokerShare: 0,
  },
  renting: { monthlyRent: 0, rentGrowth: 0, investmentReturn: 0.03 },
  shared: { cpi: 0.03, horizonYears: 12 },
});

describe('calculateRentVsBuy', () => {
  it('ties when the two sides are financially identical', () => {
    const result = calculateRentVsBuy(SYMMETRIC);

    expect(result.verdict.winner).toBe('tie');
    expect(result.verdict.difference).toBeLessThan(1);
  });

  it('moves the verdict toward buying as rent rises', () => {
    const cheap = calculateRentVsBuy(input({ renting: { monthlyRent: 3_000 } }));
    const dear = calculateRentVsBuy(input({ renting: { monthlyRent: 15_000 } }));

    expect(cheap.verdict.winner).toBe('rent');
    expect(dear.verdict.winner).toBe('buy');
  });

  it('finds a break-even rent that reproduces a tie', () => {
    const result = calculateRentVsBuy(input());
    expect(result.breakEvenRent).not.toBeNull();

    const atBreakEven = calculateRentVsBuy(input({ renting: { monthlyRent: result.breakEvenRent! } }));
    expect(atBreakEven.verdict.winner).toBe('tie');
  });

  it('charges an additional home purchase tax and מס שבח that a single home avoids', () => {
    const single = calculateRentVsBuy(input());
    const additional = calculateRentVsBuy(input({ buying: { buyerKind: 'additionalHome', downPaymentShare: 0.5 } }));
    const singleHalfDown = calculateRentVsBuy(input({ buying: { downPaymentShare: 0.5 } }));

    expect(additional.upfront.purchaseTax).toBe(purchaseTax(2_500_000, 'additionalHome').total);
    expect(single.upfront.purchaseTax).toBe(purchaseTax(2_500_000, 'singleHome').total);
    expect(additional.unrecoverable.buyer.shevachTax).toBeGreaterThan(0);
    expect(singleHalfDown.unrecoverable.buyer.shevachTax).toBe(0);
    expect(additional.verdict.buyerWealth).toBeLessThan(singleHalfDown.verdict.buyerWealth);
  });

  it('never lets either portfolio go negative', () => {
    for (const rent of [0, 4_000, 9_000, 30_000]) {
      const { months } = calculateRentVsBuy(input({ renting: { monthlyRent: rent } }));
      expect(months.every(({ buyerPortfolio, renterPortfolio }) => buyerPortfolio >= 0 && renterPortfolio >= 0))
        .toBe(true);
    }
  });

  it('pays the same mortgage the mortgage calculator prices, month for month', () => {
    const scenario = input({ shared: { horizonYears: 30 }, buying: { mortgageYears: 25 } });
    const mortgage = rentVsBuyMortgage(scenario);
    const result = calculateRentVsBuy(scenario);
    const paid = result.months.reduce((sum, { mortgagePayment }) => sum + mortgagePayment, 0);

    expect(result.monthlyMortgagePayment).toBeCloseTo(mortgage.firstPayment, 6);
    expect(paid).toBeCloseTo(mortgage.nominal.total, 4);
    expect(result.months.at(-1)?.mortgageBalance).toBe(0);
  });

  it('reports a break-even year where the yearly wealth lines cross', () => {
    const result = calculateRentVsBuy(input({ renting: { monthlyRent: 9_000 } }));
    const year = result.breakEvenYear;
    expect(year).not.toBeNull();

    const row = result.years.find((candidate) => candidate.year === year)!;
    expect(row.buyerWealth).toBeGreaterThanOrEqual(row.renterWealth);
    const before = result.years.find((candidate) => candidate.year === year! - 1);
    if (before) expect(before.buyerWealth).toBeLessThan(before.renterWealth);
  });

  it('flags a down payment below the buyer type minimum', () => {
    const result = calculateRentVsBuy(input({ buying: { downPaymentShare: 0.2 } }));

    expect(result.notices).toEqual([expect.objectContaining({ code: 'ltvAboveCap', cap: 0.75 })]);
  });

  it('charges each broker fee at its own share plus VAT', () => {
    const none = calculateRentVsBuy(input());
    const purchaseOnly = calculateRentVsBuy(input({ buying: { purchaseBrokerShare: 0.015 } }));
    const both = calculateRentVsBuy(input({ buying: { purchaseBrokerShare: 0.015, saleBrokerShare: 0.02 } }));

    expect(purchaseOnly.upfront.broker).toBeCloseTo(2_500_000 * 0.015 * (1 + ISRAEL_VAT_RATE), 6);
    expect(both.upfront.broker).toBe(purchaseOnly.upfront.broker);
    // The purchase fee is money the renter keeps invested, so it shows up on the renter's side.
    expect(purchaseOnly.verdict.renterWealth).toBeGreaterThan(none.verdict.renterWealth);
    expect(both.verdict.buyerWealth).toBeLessThan(purchaseOnly.verdict.buyerWealth);
  });

  it('prices an all-cash purchase with no mortgage or mortgage insurance', () => {
    const result = calculateRentVsBuy(input({ buying: { downPaymentShare: 1 } }));

    expect(result.loanAmount).toBe(0);
    expect(result.firstMonth.mortgage).toBe(0);
    expect(result.firstMonth.insurance).toBe(0);
    expect(result.upfront.downPayment).toBe(2_500_000);
    expect(result.notices).toEqual([]);
  });

  it('reports appreciation sensitivity around the base case', () => {
    const result = calculateRentVsBuy(input());
    const { lower, higher } = result.appreciationSensitivity;

    expect(lower.verdict.buyerWealth).toBeLessThan(result.verdict.buyerWealth);
    expect(higher.verdict.buyerWealth).toBeGreaterThan(result.verdict.buyerWealth);
  });

  it('reports the verdict under each fixed return scenario, with the default in the middle', () => {
    const result = calculateRentVsBuy(input());
    const scenarios = result.returnSensitivity;

    expect(scenarios.map(({ investmentReturn }) => investmentReturn)).toEqual([...RENT_VS_BUY_RETURN_SCENARIOS]);
    expect(scenarios[1]!.investmentReturn).toBe(RENT_VS_BUY_DEFAULTS.renting.investmentReturn);
    expect(scenarios[1]!.verdict).toEqual(result.verdict);
    const renterWealth = scenarios.map(({ verdict }) => verdict.renterWealth);
    expect(renterWealth[0]).toBeLessThan(renterWealth[1]!);
    expect(renterWealth[1]).toBeLessThan(renterWealth[2]!);
    expect(scenarios.every(({ verdict }) => verdict.buyerWealth === result.verdict.buyerWealth)).toBe(true);
  });

  it('shows the first month side by side and what the renter invests from it', () => {
    const result = calculateRentVsBuy(input());
    const { firstMonth } = result;

    expect(firstMonth.mortgage).toBeCloseTo(result.monthlyMortgagePayment, 6);
    expect(firstMonth.buyerTotal).toBeCloseTo(firstMonth.mortgage + firstMonth.ownership + firstMonth.insurance, 6);
    expect(firstMonth.rent).toBe(result.monthlyRent);
    expect(firstMonth.invested).toBeCloseTo(firstMonth.buyerTotal - firstMonth.rent, 6);
    expect(firstMonth.invested).toBeGreaterThan(0);
    // The renter's portfolio starts at the buyer's cash and grows by that first contribution.
    expect(result.months[0]!.renterPortfolio).toBeGreaterThan(result.upfront.total + firstMonth.invested);
  });

  it('accounts for the renter portfolio at the horizon', () => {
    const result = calculateRentVsBuy(input());
    const { renterPortfolio } = result;

    expect(renterPortfolio.initial).toBe(result.upfront.total);
    expect(renterPortfolio.value).toBeCloseTo(result.months.at(-1)!.renterPortfolio, 6);
    expect(renterPortfolio.tax).toBe(result.unrecoverable.renter.investmentTax);
    expect(renterPortfolio.value - renterPortfolio.tax).toBeCloseTo(result.verdict.renterWealth, 6);
    const invested = result.months.reduce((sum, month, index) => {
      const previous = index === 0 ? result.upfront.total : result.months[index - 1]!.renterPortfolio;
      const monthlyReturn = (1 + RENT_VS_BUY_DEFAULTS.renting.investmentReturn) ** (1 / 12);
      return sum + Math.max(0, month.renterPortfolio - previous * monthlyReturn);
    }, 0);
    expect(renterPortfolio.contributions).toBeCloseTo(invested, 3);
  });
});

describe('shevachTax', () => {
  it('exempts a single home sold under the ceiling', () => {
    expect(shevachTax(4_000_000, 0, 2_000_000, 'singleHome')).toBe(0);
  });

  it('taxes only the excess share of a single home sold above the ceiling', () => {
    const value = 8_000_000;
    const gain = value - 3_000_000;
    const excessShare = (value - SINGLE_HOME_SHEVACH_EXEMPTION_CEILING.value) / value;

    expect(shevachTax(value, 0, 3_000_000, 'singleHome'))
      .toBeCloseTo(gain * excessShare * REAL_GAIN_TAX_RATE, 6);
    expect(shevachTax(value, 0, 3_000_000, 'additionalHome')).toBeCloseTo(gain * REAL_GAIN_TAX_RATE, 6);
  });

  it('owes nothing on a real loss', () => {
    expect(shevachTax(2_000_000, 50_000, 2_100_000, 'additionalHome')).toBe(0);
  });
});
