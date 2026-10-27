import { CALCULATOR_MARKET_DATA, CALCULATOR_PRIME_MARGIN, type MortgageTrackRates } from './calculatorData.js';

/**
 * Israeli mortgage-mix model: a loan split into tracks (מסלולים), each with its own rate, term
 * and CPI linkage, repaid as Spitzer (equal real payments) or equal principal.
 *
 * A CPI-linked track is computed as an unlinked schedule at its quoted (real) rate and then
 * scaled month by month by the index factor I_m = (1 + cpi)^(m/12). That is exact for both
 * repayment methods: every payment, principal part and balance of a linked loan is its real
 * counterpart times the index. Every aggregate is reported nominal AND in today's shekels
 * (deflated by the same CPI path for every track), because a nominal total alone always makes
 * the linked tracks look like the expensive ones.
 *
 * Variable tracks keep their opening rate for the whole term — the model cannot know a future
 * reset — and `mortgageSensitivity` is the disclosed answer to that.
 */

export type MortgageTrackType =
  | 'prime'
  | 'fixedUnlinked'
  | 'fixedLinked'
  | 'variable5Linked'
  | 'variable5Unlinked';

export type MortgageBuyerType = 'first' | 'upgrader' | 'investor';
export type MortgageRepayment = 'spitzer' | 'equalPrincipal';
export type MortgageBasket = 'allFixed' | 'thirds' | 'halfPrime';

export interface MortgageTrackDefinition {
  linked: boolean;
  /** Counts toward the Bank of Israel's fixed-rate third. */
  fixed: boolean;
  variable: boolean;
  /** `primeSpread` tracks are quoted as a spread over prime, the rest as an annual rate. */
  priceBy: 'rate' | 'primeSpread';
  /** Annual rate, or the spread over prime for a `primeSpread` track. */
  defaultValue: number;
}

/** Bank of Israel policy rate, as last decided. */
export const BANK_OF_ISRAEL_RATE = CALCULATOR_MARKET_DATA.policy;
/** Prime is the policy rate plus this fixed margin. */
export const PRIME_MARGIN = CALCULATOR_PRIME_MARGIN;
/**
 * Month of the market averages the per-track defaults are taken from: the Bank of Israel's
 * average new-mortgage rate by track. A default is a starting point the reader edits, never a
 * quote, which is why the page shows this month beside it.
 */
export const MORTGAGE_DEFAULT_RATES_SOURCE_MONTH = CALCULATOR_MARKET_DATA.mortgage.asOf;
/** Latest observed annual CPI change, used as an editable future assumption. */
export const DEFAULT_CPI_RATE = CALCULATOR_MARKET_DATA.inflation.value;
/** Life plus structure insurance a lender requires, as a typical monthly figure. */
export const MORTGAGE_DEFAULT_MONTHLY_INSURANCE = 150;

export const MORTGAGE_TRACK_TYPES: Readonly<Record<MortgageTrackType, MortgageTrackDefinition>> = {
  prime: { linked: false, fixed: false, variable: true, priceBy: 'primeSpread', defaultValue: CALCULATOR_MARKET_DATA.mortgage.rates.prime },
  fixedUnlinked: { linked: false, fixed: true, variable: false, priceBy: 'rate', defaultValue: CALCULATOR_MARKET_DATA.mortgage.rates.fixedUnlinked },
  fixedLinked: { linked: true, fixed: true, variable: false, priceBy: 'rate', defaultValue: CALCULATOR_MARKET_DATA.mortgage.rates.fixedLinked },
  variable5Linked: { linked: true, fixed: false, variable: true, priceBy: 'rate', defaultValue: CALCULATOR_MARKET_DATA.mortgage.rates.variable5Linked },
  variable5Unlinked: { linked: false, fixed: false, variable: true, priceBy: 'rate', defaultValue: CALCULATOR_MARKET_DATA.mortgage.rates.variable5Unlinked },
};

export const MORTGAGE_TRACK_TYPE_KEYS = Object.keys(MORTGAGE_TRACK_TYPES) as MortgageTrackType[];
export const MORTGAGE_BUYER_TYPES: readonly MortgageBuyerType[] = ['first', 'upgrader', 'investor'];

/**
 * The Bank of Israel's three uniform baskets (סלים אחידים) every bank offer must price. Shares
 * are exact fractions, so a thirds basket sums to 1 and passes the fixed-third check exactly.
 */
export const MORTGAGE_PRESET_MIXES: Readonly<Record<MortgageBasket, ReadonlyArray<{
  type: MortgageTrackType;
  share: number;
}>>> = {
  allFixed: [{ type: 'fixedUnlinked', share: 1 }],
  thirds: [
    { type: 'fixedUnlinked', share: 1 / 3 },
    { type: 'variable5Linked', share: 1 / 3 },
    { type: 'prime', share: 1 / 3 },
  ],
  halfPrime: [
    { type: 'fixedUnlinked', share: 1 / 2 },
    { type: 'prime', share: 1 / 2 },
  ],
};
export const MORTGAGE_BASKETS = Object.keys(MORTGAGE_PRESET_MIXES) as MortgageBasket[];

/** Bank of Israel loan-to-value caps by buyer type (subsidised programmes allow more). */
export const MORTGAGE_LTV_CAPS: Readonly<Record<MortgageBuyerType, number>> = {
  first: 0.75,
  upgrader: 0.7,
  investor: 0.5,
};
/** Bank of Israel since 2021: at least a third of the loan at a fixed rate, linked or not. */
export const MORTGAGE_MIN_FIXED_SHARE = 1 / 3;
/** The practical ceiling banks lend to; the Bank of Israel prohibits more than half of income. */
export const MORTGAGE_PAYMENT_TO_INCOME_CEILING = 0.4;
export const MORTGAGE_PAYMENT_TO_INCOME_PROHIBITED = 0.5;
export const MORTGAGE_MAX_TERM_YEARS = 30;
/** Rounding slack for user-entered shares, so 33.3% + 33.3% + 33.4% is a whole loan. */
const SHARE_TOLERANCE = 0.005;

export interface MortgageTrackInput {
  type: MortgageTrackType;
  /** Fraction of the loan, 0–1. */
  share: number;
  /** Annual rate; for a prime track, the spread over prime. Missing → the track's default. */
  rate?: number;
  years: number;
}

export interface MortgageInput {
  propertyPrice: number;
  downPayment: number;
  buyerType: MortgageBuyerType;
  repayment: MortgageRepayment;
  /** Expected annual CPI change, e.g. 0.02. */
  cpiRate: number;
  /** Bank of Israel policy rate, which prices every prime track. */
  boiRate: number;
  /** Net monthly household income after existing loan repayments. */
  monthlyNetIncome?: number;
  monthlyInsurance?: number;
  tracks: readonly MortgageTrackInput[];
}

export interface MortgageTotals {
  total: number;
  interest: number;
  indexation: number;
  /** Shekels repaid per shekel borrowed. */
  perShekel: number;
}

export interface MortgageMonth {
  month: number;
  total: number;
  principal: number;
  interest: number;
  indexation: number;
  /** Outstanding nominal balance after this month's payment. */
  balance: number;
  /** Nominal payment of each track, in `tracks` order. */
  byTrack: number[];
}

export interface MortgageYearRow {
  year: number;
  paid: number;
  principal: number;
  interest: number;
  indexation: number;
  closingBalance: number;
}

export interface MortgageTrackSummary {
  type: MortgageTrackType;
  share: number;
  principal: number;
  /** The rate the schedule runs at; prime already resolved from the policy rate. */
  annualRate: number;
  years: number;
  firstPayment: number;
  peakPayment: number;
  nominal: MortgageTotals;
  today: MortgageTotals;
}

export type MortgageNotice =
  | { code: 'ltvAboveCap'; ltv: number; cap: number }
  | { code: 'fixedShareBelowThird'; fixedShare: number; minimum: number }
  | { code: 'paymentToIncomeAboveCeiling'; ratio: number; ceiling: number; prohibited: boolean }
  | { code: 'termAboveMax'; years: number; max: number }
  | { code: 'sharesNotHundred'; totalShare: number };

export interface MortgageResult {
  loanAmount: number;
  ltv: number;
  ltvCap: number;
  /** Down payment the buyer type's LTV cap requires. */
  minimumDownPayment: number;
  fixedShare: number;
  firstPayment: number;
  peakPayment: number;
  peakMonth: number;
  monthlyInsurance: number;
  paymentToIncome: number | null;
  nominal: MortgageTotals;
  today: MortgageTotals;
  months: MortgageMonth[];
  years: MortgageYearRow[];
  tracks: MortgageTrackSummary[];
  notices: MortgageNotice[];
}

interface ScheduleMonth {
  payment: number;
  principal: number;
  interest: number;
  indexation: number;
  balance: number;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function trackMonths(years: number): number {
  return Math.max(1, Math.round(finiteOr(years, 1) * 12));
}

/** The annual rate a track's schedule runs at. */
export function trackAnnualRate(track: Pick<MortgageTrackInput, 'type' | 'rate'>, boiRate: number): number {
  const definition = MORTGAGE_TRACK_TYPES[track.type];
  const value = finiteOr(track.rate, definition.defaultValue);
  return definition.priceBy === 'primeSpread' ? boiRate + PRIME_MARGIN + value : value;
}

/** A uniform basket as editable tracks at the default rates. */
export function mortgagePresetTracks(
  basket: MortgageBasket,
  years: number,
  rates: MortgageTrackRates = CALCULATOR_MARKET_DATA.mortgage.rates,
): MortgageTrackInput[] {
  return MORTGAGE_PRESET_MIXES[basket].map(({ type, share }) => ({
    type,
    share,
    rate: rates[type],
    years,
  }));
}

function trackSchedule(
  principal: number,
  annualRate: number,
  months: number,
  linked: boolean,
  monthlyCpiFactor: number,
  repayment: MortgageRepayment,
): ScheduleMonth[] {
  const r = annualRate / 12;
  const level = Math.abs(r) < 1e-12
    ? principal / months
    : (principal * r) / (1 - (1 + r) ** -months);
  const schedule: ScheduleMonth[] = [];
  let realBalance = principal;
  let previousIndex = 1;
  for (let month = 1; month <= months; month += 1) {
    const index = linked ? monthlyCpiFactor ** month : 1;
    const realInterest = realBalance * r;
    const realPrincipal = month === months
      ? realBalance
      : repayment === 'spitzer'
        ? level - realInterest
        : principal / months;
    const indexation = realBalance * (index - previousIndex);
    realBalance -= realPrincipal;
    schedule.push({
      payment: (realPrincipal + realInterest) * index,
      principal: realPrincipal * index,
      interest: realInterest * index,
      indexation,
      balance: Math.abs(realBalance) < 1e-6 ? 0 : realBalance * index,
    });
    previousIndex = index;
  }
  return schedule;
}

function emptyTotals(): MortgageTotals {
  return { total: 0, interest: 0, indexation: 0, perShekel: 0 };
}

function withPerShekel(totals: MortgageTotals, principal: number): MortgageTotals {
  return { ...totals, perShekel: principal > 0 ? totals.total / principal : 0 };
}

export function calculateMortgage(input: MortgageInput): MortgageResult {
  const propertyPrice = Math.max(0, finiteOr(input.propertyPrice, 0));
  const downPayment = Math.max(0, finiteOr(input.downPayment, 0));
  const loanAmount = Math.max(0, propertyPrice - downPayment);
  const cpiRate = Math.max(-0.99, finiteOr(input.cpiRate, 0));
  const monthlyCpiFactor = (1 + cpiRate) ** (1 / 12);
  const ltvCap = MORTGAGE_LTV_CAPS[input.buyerType];
  const ltv = propertyPrice > 0 ? loanAmount / propertyPrice : 0;

  const schedules = input.tracks.map((track) => {
    const definition = MORTGAGE_TRACK_TYPES[track.type];
    const share = Math.max(0, finiteOr(track.share, 0));
    const principal = loanAmount * share;
    const annualRate = trackAnnualRate(track, input.boiRate);
    const months = trackMonths(track.years);
    return {
      track,
      share,
      principal,
      annualRate,
      schedule: trackSchedule(principal, annualRate, months, definition.linked, monthlyCpiFactor, input.repayment),
    };
  });

  const horizon = schedules.reduce((max, { schedule }) => Math.max(max, schedule.length), 0);
  const months: MortgageMonth[] = [];
  const years: MortgageYearRow[] = [];
  const nominal = emptyTotals();
  const today = emptyTotals();
  let peakPayment = 0;
  let peakMonth = 1;
  for (let month = 1; month <= horizon; month += 1) {
    const deflator = monthlyCpiFactor ** month;
    const byTrack = schedules.map(({ schedule }) => schedule[month - 1]?.payment ?? 0);
    const total = byTrack.reduce((sum, value) => sum + value, 0);
    const monthRow: MortgageMonth = { month, total, principal: 0, interest: 0, indexation: 0, balance: 0, byTrack };
    months.push(monthRow);
    if (total > peakPayment + 1e-9) {
      peakPayment = total;
      peakMonth = month;
    }

    const yearIndex = Math.ceil(month / 12);
    let row = years[yearIndex - 1];
    if (!row) {
      row = { year: yearIndex, paid: 0, principal: 0, interest: 0, indexation: 0, closingBalance: 0 };
      years.push(row);
    }
    for (const { schedule } of schedules) {
      const entry = schedule[month - 1];
      if (!entry) continue;
      monthRow.principal += entry.principal;
      monthRow.interest += entry.interest;
      monthRow.indexation += entry.indexation;
      monthRow.balance += entry.balance;
      row.paid += entry.payment;
      row.principal += entry.principal;
      row.interest += entry.interest;
      row.indexation += entry.indexation;
      nominal.total += entry.payment;
      nominal.interest += entry.interest;
      nominal.indexation += entry.indexation;
      today.total += entry.payment / deflator;
      today.interest += entry.interest / deflator;
      today.indexation += entry.indexation / deflator;
    }
    row.closingBalance = monthRow.balance;
  }

  const tracks: MortgageTrackSummary[] = schedules.map(({ track, share, principal, annualRate, schedule }) => {
    const trackNominal = emptyTotals();
    const trackToday = emptyTotals();
    let trackPeak = 0;
    schedule.forEach((entry, index) => {
      const deflator = monthlyCpiFactor ** (index + 1);
      trackPeak = Math.max(trackPeak, entry.payment);
      trackNominal.total += entry.payment;
      trackNominal.interest += entry.interest;
      trackNominal.indexation += entry.indexation;
      trackToday.total += entry.payment / deflator;
      trackToday.interest += entry.interest / deflator;
      trackToday.indexation += entry.indexation / deflator;
    });
    return {
      type: track.type,
      share,
      principal,
      annualRate,
      years: schedule.length / 12,
      firstPayment: schedule[0]?.payment ?? 0,
      peakPayment: trackPeak,
      nominal: withPerShekel(trackNominal, principal),
      today: withPerShekel(trackToday, principal),
    };
  });

  const firstPayment = months[0]?.total ?? 0;
  const totalShare = schedules.reduce((sum, { share }) => sum + share, 0);
  const fixedShareOfInput = schedules
    .filter(({ track }) => MORTGAGE_TRACK_TYPES[track.type].fixed)
    .reduce((sum, { share }) => sum + share, 0);
  const fixedShare = totalShare > 0 ? fixedShareOfInput / totalShare : 0;
  const income = finiteOr(input.monthlyNetIncome, 0);
  const paymentToIncome = income > 0 ? firstPayment / income : null;
  const longestYears = input.tracks.reduce((max, track) => Math.max(max, finiteOr(track.years, 0)), 0);

  const notices: MortgageNotice[] = [];
  if (loanAmount > 0 && ltv > ltvCap + 1e-9) {
    notices.push({ code: 'ltvAboveCap', ltv, cap: ltvCap });
  }
  if (loanAmount > 0 && fixedShare < MORTGAGE_MIN_FIXED_SHARE - SHARE_TOLERANCE) {
    notices.push({ code: 'fixedShareBelowThird', fixedShare, minimum: MORTGAGE_MIN_FIXED_SHARE });
  }
  if (paymentToIncome !== null && paymentToIncome > MORTGAGE_PAYMENT_TO_INCOME_CEILING + 1e-9) {
    notices.push({
      code: 'paymentToIncomeAboveCeiling',
      ratio: paymentToIncome,
      ceiling: MORTGAGE_PAYMENT_TO_INCOME_CEILING,
      prohibited: paymentToIncome > MORTGAGE_PAYMENT_TO_INCOME_PROHIBITED + 1e-9,
    });
  }
  if (longestYears > MORTGAGE_MAX_TERM_YEARS + 1e-9) {
    notices.push({ code: 'termAboveMax', years: longestYears, max: MORTGAGE_MAX_TERM_YEARS });
  }
  if (Math.abs(totalShare - 1) > SHARE_TOLERANCE) {
    notices.push({ code: 'sharesNotHundred', totalShare });
  }

  return {
    loanAmount,
    ltv,
    ltvCap,
    minimumDownPayment: propertyPrice * (1 - ltvCap),
    fixedShare,
    firstPayment,
    peakPayment,
    peakMonth,
    monthlyInsurance: Math.max(0, finiteOr(input.monthlyInsurance, 0)),
    paymentToIncome,
    nominal: withPerShekel(nominal, loanAmount),
    today: withPerShekel(today, loanAmount),
    months,
    years,
    tracks,
    notices,
  };
}

export interface MortgageScenario {
  firstPayment: number;
  peakPayment: number;
  totalNominal: number;
}

export interface MortgageSensitivity {
  boiPlus1: MortgageScenario;
  boiPlus2: MortgageScenario;
  cpi4: MortgageScenario;
}

export const MORTGAGE_SENSITIVITY_CPI = 0.04;

function scenario(input: MortgageInput): MortgageScenario {
  const result = calculateMortgage(input);
  return {
    firstPayment: result.firstPayment,
    peakPayment: result.peakPayment,
    totalNominal: result.nominal.total,
  };
}

/**
 * What the headline does under stress. A policy-rate shock moves prime, and conservatively
 * reprices every other variable track from month 1 rather than at its next reset.
 */
export function mortgageSensitivity(input: MortgageInput): MortgageSensitivity {
  const shocked = (shock: number): MortgageInput => ({
    ...input,
    boiRate: input.boiRate + shock,
    tracks: input.tracks.map((track) => {
      const definition = MORTGAGE_TRACK_TYPES[track.type];
      if (!definition.variable || definition.priceBy === 'primeSpread') return track;
      return { ...track, rate: trackAnnualRate(track, input.boiRate) + shock };
    }),
  });
  return {
    boiPlus1: scenario(shocked(0.01)),
    boiPlus2: scenario(shocked(0.02)),
    cpi4: scenario({ ...input, cpiRate: MORTGAGE_SENSITIVITY_CPI }),
  };
}
