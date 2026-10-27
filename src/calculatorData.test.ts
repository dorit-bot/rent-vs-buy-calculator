import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  CALCULATOR_MARKET_DATA, CALCULATOR_DATA_SOURCES, effectiveToNominalRate,
  fetchCalculatorMarketData, parseCalculatorInflation, parseMortgageWorkbook,
  parsePolicyReference, validateCalculatorMarketData,
} from './calculatorData.js';

const now = new Date('2026-10-22T12:00:00Z');
const labels = ['סך מערכת', 'קבועה לא צמודה', 'משתנה לא צמודה - פריים',
  'משתנה לא צמודה שאינה פריים', 'משתנה צמוד מדד', 'קבועה צמוד מדד', '2026-09', '2026-08'];

function workbook(options: { missingLatest?: boolean; wrongLabel?: boolean; declaration?: string } = {}) {
  const strings = labels.map((text, i) => `<si><t>${options.wrongLabel && i === 3 ? 'changed' : text}</t></si>`).join('');
  const cell = (r: string, v: string | number, shared = false) => `<c r="${r}"${shared ? ' t="s"' : ''}><v>${v}</v></c>`;
  const rates = (row: number, missing = false) => ['E', 'F', 'G', 'H', 'I']
    .filter((col) => !missing || col !== 'H').map((col, i) => cell(`${col}${row}`, 4 + i / 10)).join('');
  return zipSync({
    'xl/sharedStrings.xml': strToU8(`${options.declaration ?? ''}<sst>${strings}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>
      <row>${cell('D1', 0, true)}${cell('A1', 'Another bank')}</row>
      <row>${labels.slice(1, 6).map((_, i) => cell(`${['E', 'F', 'G', 'H', 'I'][i]}2`, i + 1, true)).join('')}</row>
      <row>${cell('B3', 6, true)}${cell('A3', 99)}${rates(3, options.missingLatest)}</row>
      <row>${cell('B4', 7, true)}${rates(4)}</row>
    </sheetData></worksheet>`),
  });
}

const cpi = { month: [{ code: 120010, date: [{ year: 2026, month: 9, percentYear: 1.6, percent: 0.2 }] }] };
const history = 'SERIES_CODE,TIME_PERIOD,OBS_VALUE\r\n"MNT_RIB_BOI_D","2026-09-30","4"\r\nMNT_RIB_BOI_D,2026-09-01,4.25';
const policy = { currentInterest: 3.25, lastPublishedDate: '2026-10-21T16:00:00Z', nextInterestDate: '2026-11-23T00:00:00Z' };

describe('official calculator data', () => {
  it('selects system-wide track columns and the newest month, independently of row order', () => {
    const parsed = parseMortgageWorkbook(workbook(), now);
    expect(parsed.asOf).toBe('2026-09');
    expect(parsed.effectiveRates.fixedUnlinked).toBe(0.04);
    expect(parsed.effectiveRates.fixedLinked).toBeCloseTo(0.044);
    expect(parsed.effectiveRates.prime).toBeCloseTo(0.041);
  });

  it('rejects missing latest observations instead of silently selecting an older complete row', () => {
    expect(() => parseMortgageWorkbook(workbook({ missingLatest: true }), now)).toThrow('Missing mortgage');
    expect(() => parseMortgageWorkbook(workbook({ wrongLabel: true }), now)).toThrow('labels changed');
    expect(() => parseMortgageWorkbook(workbook(), new Date('2027-02-01'))).toThrow('stale');
  });

  it('rejects HTML/challenges, invalid archives and XML entities', () => {
    expect(() => parseMortgageWorkbook(strToU8('<html>challenge</html>'), now)).toThrow();
    expect(() => parseMortgageWorkbook(workbook({ declaration: '<!DOCTYPE sst [<!ENTITY x SYSTEM "file:///etc/passwd">]>' }), now)).toThrow('XML declaration');
  });

  it('uses annual CPI observations, including valid negative inflation, and rejects absent values', () => {
    expect(parseCalculatorInflation(cpi, now)).toEqual({ asOf: '2026-09', value: 0.016 });
    const deflation = structuredClone(cpi);
    deflation.month[0]!.date[0]!.percentYear = -0.5;
    expect(parseCalculatorInflation(deflation, now).value).toBe(-0.005);
    expect(() => parseCalculatorInflation({ month: [{ code: 120010, date: [{ year: 2026, month: 9, percentYear: null }] }] }, now)).toThrow();
    expect(() => parseCalculatorInflation({ month: [{ code: 123, date: [] }] }, now)).toThrow();
  });

  it('requires the correct series and a complete month-end policy observation', () => {
    expect(parsePolicyReference(history, '2026-09')).toEqual({ value: 0.04, asOf: '2026-09-30' });
    expect(() => parsePolicyReference(history.replace('2026-09-30', '2026-09-02'), '2026-09')).toThrow('Incomplete');
    expect(() => parsePolicyReference(history.replaceAll('MNT_RIB_BOI_D', 'OTHER'), '2026-09')).toThrow('Missing historical');
  });

  it('converts effective annual rates to the monthly convention used by the schedule', () => {
    expect((1 + effectiveToNominalRate(0.06) / 12) ** 12 - 1).toBeCloseTo(0.06, 12);
    expect(validateCalculatorMarketData(CALCULATOR_MARKET_DATA)).toEqual(CALCULATOR_MARKET_DATA);
    const corrupt = structuredClone(CALCULATOR_MARKET_DATA);
    corrupt.mortgage.rates.fixedLinked += 0.01;
    expect(() => validateCalculatorMarketData(corrupt)).toThrow('Inconsistent');
  });

  function sourceFetcher(failure?: 'cpi' | 'oversize' | 'stale') {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === CALCULATOR_DATA_SOURCES.mortgage) return new Response(workbook());
      if (url === CALCULATOR_DATA_SOURCES.cpi) {
        if (failure === 'cpi') return new Response('unavailable', { status: 503 });
        if (failure === 'oversize') return new Response('x'.repeat(2_000_001));
        return Response.json(cpi);
      }
      if (url === CALCULATOR_DATA_SOURCES.policy) return Response.json({ ...policy,
        ...(failure === 'stale' ? { nextInterestDate: '2026-09-01' } : {}),
      });
      expect(new URL(url).searchParams.get('endperiod')).toBe('2026-09-30');
      return new Response(history);
    }) as typeof fetch;
  }

  it('infers prime discount from the reporting month, even when today’s policy rate differs', async () => {
    const data = await fetchCalculatorMarketData({ fetcher: sourceFetcher(), now });
    expect(data.policy.value).toBe(0.0325);
    expect(data.mortgage.primeReference.value).toBe(0.04);
    expect(data.mortgage.rates.prime).toBeCloseTo(effectiveToNominalRate(0.041) - 0.055, 12);
    expect(data.checkedAt).toBe(now.toISOString());
  });

  it.each(['cpi', 'oversize', 'stale'] as const)('rejects the whole refresh on %s source failure', async (failure) => {
    await expect(fetchCalculatorMarketData({ fetcher: sourceFetcher(failure), now })).rejects.toThrow();
  });
});
