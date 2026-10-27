import {
  BANK_OF_ISRAEL_RATE,
  DEFAULT_CPI_RATE,
  MORTGAGE_DEFAULT_MONTHLY_INSURANCE,
  calculateMortgage,
  mortgagePresetTracks,
  type MortgageBasket,
  type MortgageBuyerType,
  type MortgageResult,
} from './mortgage.js';
import { purchaseTax, type PurchaseTaxKind } from './purchaseTax.js';
import type { MortgageTrackRates } from './calculatorData.js';

/**
 * Rent-versus-buy as two households with the same money, simulated month by month.
 *
 * Both start from the buyer's upfront cash: the buyer spends it on the down payment and
 * transaction costs, the renter invests all of it. Every month, whichever side paid less invests
 * the difference in its own portfolio, so neither side borrows implicitly and neither portfolio
 * goes negative. At the horizon the buyer sells — selling costs, the outstanding (indexed)
 * mortgage balance and land-appreciation tax (מס שבח) come off — and both portfolios pay
 * capital-gains tax on their real gain. The verdict compares those two after-tax net worths.
 *
 * The mortgage is `calculateMortgage` on one of the uniform baskets at the same default rates as
 * the mortgage calculator, so the two pages never quote different payments for one loan.
 */

export const ISRAEL_VAT_RATE = 0.18;
/** The customary broker's fee on a purchase or a sale: 2% of the price, plus VAT. */
export const PROPERTY_BROKER_FEE_SHARE = 0.02;
/** Capital-gains tax on securities and on a taxable מס שבח gain alike: 25% of the real gain. */
export const REAL_GAIN_TAX_RATE = 0.25;
/**
 * Sale value up to which selling one's only home is fully exempt from מס שבח (section 49א(א1)).
 * Frozen at its 2024 level for 2025–2027 instead of being indexed.
 */
export const SINGLE_HOME_SHEVACH_EXEMPTION_CEILING = { value: 5_008_000, frozenThrough: '2027-12-31' } as const;

export type RentVsBuyBuyerKind = PurchaseTaxKind;

export interface RentVsBuyInput {
  buying: {
    price: number;
    /** Fraction of the price paid from savings, 0–1. */
    downPaymentShare: number;
    basket: MortgageBasket;
    mortgageYears: number;
    buyerKind: RentVsBuyBuyerKind;
    /** Broker's fee on the purchase as a share of the price, before VAT; 0 for no broker. */
    purchaseBrokerShare: number;
    /** Broker's fee on the sale as a share of the sale value, before VAT; 0 for no broker. */
    saleBrokerShare: number;
    /** Lawyer's fee as a share of the price, before VAT, paid on purchase and on sale. */
    lawyerShare: number;
    /** Yearly upkeep, repairs and building fees as a share of the home's value. */
    ownershipCostShare: number;
    /** Expected yearly change in the home's value. */
    appreciation: number;
    monthlyInsurance?: number;
    mortgageTrackRates?: MortgageTrackRates;
  };
  renting: {
    monthlyRent: number;
    rentGrowth: number;
    /** Expected yearly return of the invested savings, nominal and after fees. */
    investmentReturn: number;
  };
  shared: {
    cpi: number;
    boiRate: number;
    horizonYears: number;
  };
}

export const RENT_VS_BUY_DEFAULTS: RentVsBuyInput = {
  buying: {
    price: 2_500_000,
    downPaymentShare: 0.3,
    basket: 'thirds',
    mortgageYears: 25,
    buyerKind: 'singleHome',
    purchaseBrokerShare: 0,
    saleBrokerShare: 0,
    lawyerShare: 0.005,
    ownershipCostShare: 0.006,
    appreciation: 0.03,
    monthlyInsurance: MORTGAGE_DEFAULT_MONTHLY_INSURANCE,
  },
  renting: {
    monthlyRent: 6_500,
    rentGrowth: 0.03,
    investmentReturn: 0.07,
  },
  shared: {
    cpi: DEFAULT_CPI_RATE,
    boiRate: BANK_OF_ISRAEL_RATE.value,
    horizonYears: 15,
  },
};

export const RENT_VS_BUY_MAX_HORIZON_YEARS = 40;
export const RENT_VS_BUY_APPRECIATION_SHOCK = 0.02;
/**
 * Fixed return scenarios shown beside the verdict. The default sits in the middle: 10% is the
 * S&P 500's long-run nominal average, 5% a cautious mixed portfolio, so a reader sees the verdict
 * under the optimistic and the conservative case without touching the form.
 */
export const RENT_VS_BUY_RETURN_SCENARIOS = [0.05, 0.07, 0.1] as const;

export interface RentVsBuyUpfront {
  downPayment: number;
  purchaseTax: number;
  lawyer: number;
  broker: number;
  total: number;
}

export interface RentVsBuyMonth {
  month: number;
  mortgagePayment: number;
  ownershipCost: number;
  insurance: number;
  rent: number;
  buyerPortfolio: number;
  renterPortfolio: number;
  propertyValue: number;
  mortgageBalance: number;
}

export interface RentVsBuyYear {
  year: number;
  buyerWealth: number;
  renterWealth: number;
  propertyValue: number;
  mortgageBalance: number;
}

export type RentVsBuyWinner = 'buy' | 'rent' | 'tie';

export interface RentVsBuyVerdict {
  winner: RentVsBuyWinner;
  /** Absolute gap between the two net worths at the horizon. */
  difference: number;
  buyerWealth: number;
  renterWealth: number;
}

export interface RentVsBuyUnrecoverable {
  buyer: {
    interest: number;
    indexation: number;
    ownership: number;
    insurance: number;
    purchaseCosts: number;
    sellingCosts: number;
    shevachTax: number;
    investmentTax: number;
    total: number;
  };
  renter: {
    rent: number;
    investmentTax: number;
    total: number;
  };
}

export type RentVsBuyNotice = { code: 'ltvAboveCap'; ltv: number; cap: number };

/** The two households' first month side by side. */
export interface RentVsBuyFirstMonth {
  mortgage: number;
  ownership: number;
  insurance: number;
  buyerTotal: number;
  rent: number;
  /** `buyerTotal − rent`: what the renter invests that month, or (negative) what the buyer does. */
  invested: number;
}

/** The renter's investments at the horizon, before and after the real-gain tax. */
export interface RentVsBuyRenterPortfolio {
  initial: number;
  contributions: number;
  value: number;
  tax: number;
}

export interface RentVsBuyResult {
  horizonYears: number;
  upfront: RentVsBuyUpfront;
  loanAmount: number;
  monthlyMortgagePayment: number;
  monthlyRent: number;
  months: RentVsBuyMonth[];
  years: RentVsBuyYear[];
  verdict: RentVsBuyVerdict;
  /** First year-end at which buying is ahead; 0 when it starts ahead. */
  breakEvenYear: number | null;
  /** First later year-end at which renting retakes the lead. */
  recrossYear: number | null;
  /** Starting monthly rent at which the two tie at the horizon. */
  breakEvenRent: number | null;
  unrecoverable: RentVsBuyUnrecoverable;
  firstMonth: RentVsBuyFirstMonth;
  renterPortfolio: RentVsBuyRenterPortfolio;
  appreciationSensitivity: {
    lower: { appreciation: number; verdict: RentVsBuyVerdict };
    higher: { appreciation: number; verdict: RentVsBuyVerdict };
  };
  returnSensitivity: Array<{ investmentReturn: number; verdict: RentVsBuyVerdict }>;
  notices: RentVsBuyNotice[];
  mortgage: MortgageResult;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function buyerTypeFor(kind: RentVsBuyBuyerKind): MortgageBuyerType {
  return kind === 'singleHome' ? 'first' : 'investor';
}

export function rentVsBuyMortgage(input: RentVsBuyInput): MortgageResult {
  const price = Math.max(0, finiteOr(input.buying.price, 0));
  const downShare = Math.min(1, Math.max(0, finiteOr(input.buying.downPaymentShare, 0)));
  return calculateMortgage({
    propertyPrice: price,
    downPayment: price * downShare,
    buyerType: buyerTypeFor(input.buying.buyerKind),
    repayment: 'spitzer',
    cpiRate: input.shared.cpi,
    boiRate: input.shared.boiRate,
    monthlyInsurance: input.buying.monthlyInsurance,
    tracks: mortgagePresetTracks(input.buying.basket, input.buying.mortgageYears, input.buying.mortgageTrackRates),
  });
}

export function rentVsBuyUpfront(input: RentVsBuyInput): RentVsBuyUpfront {
  const price = Math.max(0, finiteOr(input.buying.price, 0));
  const downPayment = price * Math.min(1, Math.max(0, finiteOr(input.buying.downPaymentShare, 0)));
  const tax = purchaseTax(price, input.buying.buyerKind).total;
  const lawyer = price * Math.max(0, finiteOr(input.buying.lawyerShare, 0)) * (1 + ISRAEL_VAT_RATE);
  const broker = price * Math.max(0, finiteOr(input.buying.purchaseBrokerShare, 0)) * (1 + ISRAEL_VAT_RATE);
  return {
    downPayment,
    purchaseTax: tax,
    lawyer,
    broker,
    total: downPayment + tax + lawyer + broker,
  };
}

/** מס שבח on selling at `value`, against a basis indexed to the sale date. */
export function shevachTax(
  value: number,
  sellingCosts: number,
  indexedBasis: number,
  kind: RentVsBuyBuyerKind,
): number {
  const realGain = Math.max(0, value - sellingCosts - indexedBasis);
  if (realGain === 0) return 0;
  if (kind === 'additionalHome') return realGain * REAL_GAIN_TAX_RATE;
  const ceiling = SINGLE_HOME_SHEVACH_EXEMPTION_CEILING.value;
  if (value <= ceiling) return 0;
  return realGain * ((value - ceiling) / value) * REAL_GAIN_TAX_RATE;
}

function afterTax(portfolio: number, basis: number): { value: number; tax: number } {
  const tax = Math.max(0, portfolio - basis) * REAL_GAIN_TAX_RATE;
  return { value: portfolio - tax, tax };
}

interface Simulation {
  months: RentVsBuyMonth[];
  years: RentVsBuyYear[];
  verdict: RentVsBuyVerdict;
  unrecoverable: RentVsBuyUnrecoverable;
  firstMonth: RentVsBuyFirstMonth;
  renterPortfolio: RentVsBuyRenterPortfolio;
}

function verdictFor(buyerWealth: number, renterWealth: number, tolerance: number): RentVsBuyVerdict {
  const gap = buyerWealth - renterWealth;
  return {
    winner: Math.abs(gap) <= tolerance ? 'tie' : gap > 0 ? 'buy' : 'rent',
    difference: Math.abs(gap),
    buyerWealth,
    renterWealth,
  };
}

function tieTolerance(price: number): number {
  return Math.max(1_000, price * 0.001);
}

function simulate(
  input: RentVsBuyInput,
  mortgage: MortgageResult,
  upfront: RentVsBuyUpfront,
  monthlyRent: number,
): Simulation {
  const { buying, renting, shared } = input;
  const price = Math.max(0, finiteOr(buying.price, 0));
  const horizonMonths = Math.round(
    Math.min(RENT_VS_BUY_MAX_HORIZON_YEARS, Math.max(1, finiteOr(shared.horizonYears, 1))) * 12,
  );
  const monthlyCpi = (1 + Math.max(-0.99, finiteOr(shared.cpi, 0))) ** (1 / 12);
  const monthlyReturn = (1 + Math.max(-0.99, finiteOr(renting.investmentReturn, 0))) ** (1 / 12);
  const monthlyAppreciation = (1 + Math.max(-0.99, finiteOr(buying.appreciation, 0))) ** (1 / 12);
  const rentGrowth = Math.max(-0.99, finiteOr(renting.rentGrowth, 0));
  const ownershipShare = Math.max(0, finiteOr(buying.ownershipCostShare, 0));
  const lawyerShare = Math.max(0, finiteOr(buying.lawyerShare, 0));
  const saleBrokerShare = Math.max(0, finiteOr(buying.saleBrokerShare, 0));
  const insuranceBase = Math.max(0, finiteOr(buying.monthlyInsurance, 0));
  const purchaseCosts = upfront.purchaseTax + upfront.lawyer + upfront.broker;
  const tolerance = tieTolerance(price);

  const balanceAt = (month: number): number => (
    month === 0 ? mortgage.loanAmount : mortgage.months[month - 1]?.balance ?? 0
  );

  const sale = (month: number, value: number) => {
    const sellingCosts = value * (lawyerShare + saleBrokerShare) * (1 + ISRAEL_VAT_RATE);
    const indexedBasis = (price + purchaseCosts) * monthlyCpi ** month;
    const tax = shevachTax(value, sellingCosts, indexedBasis, buying.buyerKind);
    return { sellingCosts, tax, net: value - sellingCosts - tax - balanceAt(month) };
  };

  let buyerPortfolio = 0;
  let buyerBasis = 0;
  let renterPortfolio = upfront.total;
  let renterBasis = upfront.total;
  let ownershipValueBase = price;
  let interestPaid = 0;
  let indexationAccrued = 0;
  let ownershipPaid = 0;
  let insurancePaid = 0;
  let rentPaid = 0;
  let renterContributions = 0;
  let firstMonth: RentVsBuyFirstMonth | null = null;

  const months: RentVsBuyMonth[] = [];
  const opening = sale(0, price);
  const years: RentVsBuyYear[] = [{
    year: 0,
    buyerWealth: opening.net,
    renterWealth: afterTax(renterPortfolio, renterBasis).value,
    propertyValue: price,
    mortgageBalance: mortgage.loanAmount,
  }];

  for (let month = 1; month <= horizonMonths; month += 1) {
    const yearIndex = Math.floor((month - 1) / 12);
    const propertyValue = price * monthlyAppreciation ** month;
    if ((month - 1) % 12 === 0) ownershipValueBase = price * monthlyAppreciation ** (month - 1);
    const mortgagePayment = mortgage.months[month - 1]?.total ?? 0;
    const insurance = mortgagePayment > 0 ? insuranceBase * (1 + finiteOr(shared.cpi, 0)) ** yearIndex : 0;
    const ownershipCost = (ownershipShare * ownershipValueBase) / 12;
    const rent = Math.max(0, monthlyRent) * (1 + rentGrowth) ** yearIndex;

    buyerPortfolio *= monthlyReturn;
    renterPortfolio *= monthlyReturn;
    buyerBasis *= monthlyCpi;
    renterBasis *= monthlyCpi;
    const difference = mortgagePayment + ownershipCost + insurance - rent;
    if (difference > 0) {
      renterPortfolio += difference;
      renterBasis += difference;
      renterContributions += difference;
    } else {
      buyerPortfolio -= difference;
      buyerBasis -= difference;
    }
    firstMonth ??= {
      mortgage: mortgagePayment,
      ownership: ownershipCost,
      insurance,
      buyerTotal: mortgagePayment + ownershipCost + insurance,
      rent,
      invested: difference,
    };

    interestPaid += mortgage.months[month - 1]?.interest ?? 0;
    indexationAccrued += mortgage.months[month - 1]?.indexation ?? 0;
    ownershipPaid += ownershipCost;
    insurancePaid += insurance;
    rentPaid += rent;

    const mortgageBalance = balanceAt(month);
    months.push({
      month,
      mortgagePayment,
      ownershipCost,
      insurance,
      rent,
      buyerPortfolio,
      renterPortfolio,
      propertyValue,
      mortgageBalance,
    });

    if (month % 12 === 0 || month === horizonMonths) {
      years.push({
        year: month / 12,
        buyerWealth: sale(month, propertyValue).net + afterTax(buyerPortfolio, buyerBasis).value,
        renterWealth: afterTax(renterPortfolio, renterBasis).value,
        propertyValue,
        mortgageBalance,
      });
    }
  }

  const finalValue = price * monthlyAppreciation ** horizonMonths;
  const finalSale = sale(horizonMonths, finalValue);
  const buyerAfterTax = afterTax(buyerPortfolio, buyerBasis);
  const renterAfterTax = afterTax(renterPortfolio, renterBasis);
  const buyerWealth = finalSale.net + buyerAfterTax.value;
  const renterWealth = renterAfterTax.value;
  const buyerCosts = {
    interest: interestPaid,
    indexation: indexationAccrued,
    ownership: ownershipPaid,
    insurance: insurancePaid,
    purchaseCosts,
    sellingCosts: finalSale.sellingCosts,
    shevachTax: finalSale.tax,
    investmentTax: buyerAfterTax.tax,
  };

  return {
    months,
    years,
    verdict: verdictFor(buyerWealth, renterWealth, tolerance),
    firstMonth: firstMonth ?? { mortgage: 0, ownership: 0, insurance: 0, buyerTotal: 0, rent: 0, invested: 0 },
    renterPortfolio: {
      initial: upfront.total,
      contributions: renterContributions,
      value: renterPortfolio,
      tax: renterAfterTax.tax,
    },
    unrecoverable: {
      buyer: { ...buyerCosts, total: Object.values(buyerCosts).reduce((sum, value) => sum + value, 0) },
      renter: {
        rent: rentPaid,
        investmentTax: renterAfterTax.tax,
        total: rentPaid + renterAfterTax.tax,
      },
    },
  };
}

function breakEvenYears(years: RentVsBuyYear[], tolerance: number): {
  breakEvenYear: number | null;
  recrossYear: number | null;
} {
  const first = years.find(({ buyerWealth, renterWealth }) => buyerWealth - renterWealth >= 0);
  if (!first) return { breakEvenYear: null, recrossYear: null };
  const recross = years.find(({ year, buyerWealth, renterWealth }) => (
    year > first.year && buyerWealth - renterWealth < -tolerance
  ));
  return { breakEvenYear: first.year, recrossYear: recross?.year ?? null };
}

function findBreakEvenRent(
  input: RentVsBuyInput,
  mortgage: MortgageResult,
  upfront: RentVsBuyUpfront,
): number | null {
  const gapAt = (rent: number) => {
    const { verdict } = simulate(input, mortgage, upfront, rent);
    return verdict.buyerWealth - verdict.renterWealth;
  };
  const price = Math.max(0, finiteOr(input.buying.price, 0));
  let low = 0;
  let high = Math.max(10 * Math.max(0, finiteOr(input.renting.monthlyRent, 0)), price / 100, 1_000);
  let gapLow = gapAt(low);
  const gapHigh = gapAt(high);
  if (gapLow === 0) return 0;
  if (Math.sign(gapLow) === Math.sign(gapHigh)) return null;
  for (let iteration = 0; iteration < 50 && high - low > 1; iteration += 1) {
    const mid = (low + high) / 2;
    const gapMid = gapAt(mid);
    if (Math.sign(gapMid) === Math.sign(gapLow)) {
      low = mid;
      gapLow = gapMid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

export function calculateRentVsBuy(input: RentVsBuyInput): RentVsBuyResult {
  const mortgage = rentVsBuyMortgage(input);
  const upfront = rentVsBuyUpfront(input);
  const monthlyRent = Math.max(0, finiteOr(input.renting.monthlyRent, 0));
  const main = simulate(input, mortgage, upfront, monthlyRent);
  const price = Math.max(0, finiteOr(input.buying.price, 0));
  const tolerance = tieTolerance(price);
  const shiftedVerdict = (shift: number) => {
    const appreciation = finiteOr(input.buying.appreciation, 0) + shift;
    const shifted = { ...input, buying: { ...input.buying, appreciation } };
    return { appreciation, verdict: simulate(shifted, mortgage, upfront, monthlyRent).verdict };
  };
  const ltvNotice = mortgage.notices.find((notice) => notice.code === 'ltvAboveCap');

  return {
    horizonYears: main.months.length / 12,
    upfront,
    loanAmount: mortgage.loanAmount,
    monthlyMortgagePayment: mortgage.firstPayment,
    monthlyRent,
    months: main.months,
    years: main.years,
    verdict: main.verdict,
    ...breakEvenYears(main.years, tolerance),
    breakEvenRent: findBreakEvenRent(input, mortgage, upfront),
    unrecoverable: main.unrecoverable,
    firstMonth: main.firstMonth,
    renterPortfolio: main.renterPortfolio,
    appreciationSensitivity: {
      lower: shiftedVerdict(-RENT_VS_BUY_APPRECIATION_SHOCK),
      higher: shiftedVerdict(RENT_VS_BUY_APPRECIATION_SHOCK),
    },
    returnSensitivity: RENT_VS_BUY_RETURN_SCENARIOS.map((investmentReturn) => ({
      investmentReturn,
      verdict: simulate(
        { ...input, renting: { ...input.renting, investmentReturn } },
        mortgage,
        upfront,
        monthlyRent,
      ).verdict,
    })),
    notices: ltvNotice && ltvNotice.code === 'ltvAboveCap'
      ? [{ code: 'ltvAboveCap', ltv: ltvNotice.ltv, cap: ltvNotice.cap }]
      : [],
    mortgage,
  };
}
