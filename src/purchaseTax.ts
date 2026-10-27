export type PurchaseTaxKind = 'singleHome' | 'additionalHome';

export interface PurchaseTaxBracket {
  /** Upper bound of the bracket in ₪; null for the open top bracket. */
  upTo: number | null;
  rate: number;
}

/**
 * Israel's residential purchase-tax (מס רכישה) brackets. The Tax Authority set these on
 * 2025-01-16 and froze them until 2028-01-15 instead of indexing them, so they are the 2026
 * brackets too. Replace the table, never interpolate it: a bracket edge is a legal number.
 */
export const PURCHASE_TAX_BRACKETS = {
  effectiveFrom: '2025-01-16',
  frozenUntil: '2028-01-15',
  singleHome: [
    { upTo: 1_978_745, rate: 0 },
    { upTo: 2_347_040, rate: 0.035 },
    { upTo: 6_055_070, rate: 0.05 },
    { upTo: 20_183_565, rate: 0.08 },
    { upTo: null, rate: 0.1 },
  ],
  additionalHome: [
    { upTo: 6_055_070, rate: 0.08 },
    { upTo: null, rate: 0.1 },
  ],
} as const satisfies {
  effectiveFrom: string;
  frozenUntil: string;
  singleHome: readonly PurchaseTaxBracket[];
  additionalHome: readonly PurchaseTaxBracket[];
};

export interface PurchaseTaxBracketAmount {
  from: number;
  to: number | null;
  rate: number;
  taxable: number;
  tax: number;
}

export interface PurchaseTaxResult {
  total: number;
  byBracket: PurchaseTaxBracketAmount[];
}

/** Marginal purchase tax on a residential purchase price. */
export function purchaseTax(price: number, kind: PurchaseTaxKind): PurchaseTaxResult {
  const amount = Number.isFinite(price) ? Math.max(0, price) : 0;
  const byBracket: PurchaseTaxBracketAmount[] = [];
  let from = 0;
  let total = 0;
  for (const bracket of PURCHASE_TAX_BRACKETS[kind]) {
    const to = bracket.upTo;
    const taxable = Math.max(0, Math.min(amount, to ?? Number.POSITIVE_INFINITY) - from);
    const tax = taxable * bracket.rate;
    byBracket.push({ from, to, rate: bracket.rate, taxable, tax });
    total += tax;
    if (to === null) break;
    from = to;
  }
  return { total, byBracket };
}
