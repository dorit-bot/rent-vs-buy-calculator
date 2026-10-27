import { strFromU8, unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import snapshot from './calculatorMarketData.json' with { type: 'json' };
import type { MortgageTrackType } from './mortgage.js';

export type MortgageTrackRates = Record<MortgageTrackType, number>;

export const CALCULATOR_DATA_SOURCES = {
  policy: 'https://www.boi.org.il/PublicApi/GetInterest',
  mortgage: 'https://www.boi.org.il/boi_files/Pikuah/TamInt010.xls',
  policyHistory: 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/BR/1.0/',
  cpi: 'https://api.cbs.gov.il/index/data/price?id=120010&format=json&download=false&lang=en&last=1',
} as const;

export interface CalculatorMarketData {
  schemaVersion: 1;
  checkedAt: string;
  policy: { value: number; asOf: string; nextDecision: string };
  mortgage: {
    asOf: string;
    /** Nominal annual rates; prime is a spread over policy + 1.5 percentage points. */
    rates: MortgageTrackRates;
    effectiveRates: MortgageTrackRates;
    /** Month-end policy rate used to infer the historical prime discount. */
    primeReference: { value: number; asOf: string };
  };
  /** Observed twelve-month inflation, used only as an editable starting assumption. */
  inflation: { value: number; asOf: string };
}

export const CALCULATOR_MARKET_DATA: CalculatorMarketData = snapshot as CalculatorMarketData;
export const CALCULATOR_PRIME_MARGIN = 0.015;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function number(value: unknown, low: number, high: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) {
    throw new Error('Invalid or missing rate');
  }
  return value;
}

function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error('Invalid publication date');
  return value.slice(0, 10);
}

function month(value: unknown, now: Date): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('Invalid observation month');
  const age = now.getTime() - Date.parse(value + '-01');
  if (age < 0 || age > 125 * 86_400_000) throw new Error('Missing or stale monthly data');
  return value;
}

export function validateCalculatorMarketData(value: unknown): CalculatorMarketData {
  const data = object(value);
  if (data['schemaVersion'] !== 1) throw new Error('Unsupported calculator data version');
  date(data['checkedAt']);
  const policy = object(data['policy']);
  number(policy['value'], 0, 0.3);
  date(policy['asOf']);
  date(policy['nextDecision']);
  const mortgage = object(data['mortgage']);
  if (typeof mortgage['asOf'] !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mortgage['asOf'])) {
    throw new Error('Invalid mortgage month');
  }
  for (const name of ['rates', 'effectiveRates']) {
    const rates = object(mortgage[name]);
    for (const key of ['prime', 'fixedUnlinked', 'fixedLinked', 'variable5Linked', 'variable5Unlinked']) {
      number(rates[key], name === 'rates' && key === 'prime' ? -0.1 : 0, 0.3);
    }
  }
  const reference = object(mortgage['primeReference']);
  number(reference['value'], 0, 0.3);
  if (!date(reference['asOf']).startsWith(String(mortgage['asOf']))) throw new Error('Mismatched prime reference month');
  const rates = object(mortgage['rates']);
  const effective = object(mortgage['effectiveRates']);
  for (const key of Object.keys(effective)) {
    const expected = effectiveToNominalRate(number(effective[key], 0, 0.3))
      - (key === 'prime' ? Number(reference['value']) + CALCULATOR_PRIME_MARGIN : 0);
    if (typeof rates[key] !== 'number' || Math.abs(rates[key] - expected) > 1e-10) {
      throw new Error('Inconsistent effective and nominal rates');
    }
  }
  const inflation = object(data['inflation']);
  number(inflation['value'], -0.2, 0.5);
  if (typeof inflation['asOf'] !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(inflation['asOf'])) {
    throw new Error('Invalid inflation month');
  }
  const checkedAt = new Date(String(data['checkedAt']));
  month(mortgage['asOf'], checkedAt);
  month(inflation['asOf'], checkedAt);
  if (Date.parse(String(policy['asOf'])) > checkedAt.getTime()) throw new Error('Future policy publication');
  return value as CalculatorMarketData;
}

/** The source quotes effective annual rates; the schedule divides NOMINAL annual rates by 12. */
export function effectiveToNominalRate(effective: number): number {
  return 12 * Math.expm1(Math.log1p(effective) / 12);
}

function xml(bytes: Uint8Array): unknown {
  const text = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Unsupported XML declaration');
  return new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(text) as unknown;
}

function stringText(value: unknown): string {
  if (typeof value === 'string') return value;
  const entry = object(value);
  if (entry['t'] !== undefined) return stringText(entry['t']);
  if (entry['#text'] !== undefined) return stringText(entry['#text']);
  return list(entry['r']).map(stringText).join('');
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0];
  if (!letters) throw new Error('Invalid spreadsheet cell reference');
  return [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0);
}

/** Selects the system-wide block by its labels, never one bank's similarly-shaped columns. */
export function parseMortgageWorkbook(bytes: Uint8Array, now: Date): { asOf: string; effectiveRates: MortgageTrackRates } {
  const allowed = new Set(['xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']);
  const files = unzipSync(bytes, {
    filter: (file) => allowed.has(file.name) && file.originalSize <= 2_000_000,
  });
  const stringsFile = files['xl/sharedStrings.xml'];
  const sheetFile = files['xl/worksheets/sheet1.xml'];
  if (!stringsFile || !sheetFile) throw new Error('Mortgage workbook layout changed');
  const strings = list(object(object(xml(stringsFile))['sst'])['si']).map(stringText);
  const sheet = object(object(xml(sheetFile))['worksheet']);
  const rows = list(object(sheet['sheetData'])['row']).map((row) => {
    const cells = new Map<number, string>();
    for (const item of list(object(row)['c'])) {
      const cell = object(item);
      const reference = cell['@_r'];
      if (typeof reference !== 'string') throw new Error('Missing cell reference');
      const raw = cell['v'];
      if (raw === undefined) continue;
      const text = cell['@_t'] === 's' ? strings[Number(raw)] : String(raw);
      if (text !== undefined) cells.set(columnIndex(reference), text.trim());
    }
    return cells;
  });
  const systemRow = rows.find((row) => [...row.values()].includes('סך מערכת'));
  const systemStart = [...(systemRow?.entries() ?? [])].find(([, value]) => value === 'סך מערכת')?.[0];
  if (systemStart === undefined) throw new Error('Missing system-wide mortgage rates');
  const headers = rows.find((row) => row.get(systemStart + 1) === 'קבועה לא צמודה');
  const labels: Array<[MortgageTrackType, string]> = [
    ['fixedUnlinked', 'קבועה לא צמודה'],
    ['prime', 'משתנה לא צמודה - פריים'],
    ['variable5Unlinked', 'משתנה לא צמודה שאינה פריים'],
    ['variable5Linked', 'משתנה צמוד מדד'],
    ['fixedLinked', 'קבועה צמוד מדד'],
  ];
  const columns = labels.map(([type, label], index) => {
    const column = systemStart + index + 1;
    if (headers?.get(column) !== label) throw new Error('Mortgage track labels changed');
    return { type, column };
  });
  const dated = rows.flatMap((row) => {
    const period = [...row.values()].find((value) => /^\d{4}-\d{2}$/.test(value));
    return period ? [{ period, row }] : [];
  }).sort((a, b) => b.period.localeCompare(a.period));
  const latest = dated[0];
  if (!latest) throw new Error('No mortgage observations');
  const asOf = month(latest.period, now);
  const effectiveRates = Object.fromEntries(columns.map(({ type, column }) => {
    const raw = latest.row.get(column);
    if (!raw || raw.trim() === '') throw new Error('Missing mortgage track rate');
    return [type, number(Number(raw) / 100, 0.00001, 0.3)];
  })) as MortgageTrackRates;
  return { asOf, effectiveRates };
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(field.replace(/\r$/, ''));
      field = '';
      if (c === '\n') { rows.push(row); row = []; }
    } else field += c;
  }
  if (quoted) throw new Error('Invalid policy-rate CSV');
  if (field || row.length) rows.push([...row, field.replace(/\r$/, '')]);
  return rows;
}

export function parsePolicyReference(text: string, period: string): { value: number; asOf: string } {
  const [header, ...rows] = csvRows(text.replace(/^\uFEFF/, ''));
  if (!header) throw new Error('Missing policy-rate history');
  const code = header.indexOf('SERIES_CODE');
  const time = header.indexOf('TIME_PERIOD');
  const value = header.indexOf('OBS_VALUE');
  if (Math.min(code, time, value) < 0) throw new Error('Policy-rate history format changed');
  const observations = rows.filter((row) => row[code] === 'MNT_RIB_BOI_D'
    && row[time]?.startsWith(period + '-')).sort((a, b) => b[time]!.localeCompare(a[time]!));
  const last = observations[0];
  if (!last || !last[value]?.trim()) throw new Error('Missing historical policy rate');
  const [year, m] = period.split('-').map(Number);
  const monthEnd = Date.UTC(year!, m!, 0);
  if (monthEnd - Date.parse(date(last[time])) > 4 * 86_400_000) throw new Error('Incomplete policy-rate history');
  return { value: number(Number(last[value]) / 100, 0, 0.3), asOf: date(last[time]) };
}

export function parseCalculatorInflation(payload: unknown, now: Date): CalculatorMarketData['inflation'] {
  const series = list(object(payload)['month']).map(object).find((row) => row['code'] === 120010);
  const rows = list(series?.['date']).map(object).map((row) => {
    const year = number(row['year'], 2000, 2200);
    const m = number(row['month'], 1, 12);
    if (!Number.isInteger(year) || !Number.isInteger(m)) throw new Error('Invalid CPI observation');
    return { asOf: `${year}-${String(m).padStart(2, '0')}`, value: number(row['percentYear'], -20, 50) / 100 };
  }).sort((a, b) => b.asOf.localeCompare(a.asOf));
  if (!rows[0]) throw new Error('Missing CPI observation');
  return { ...rows[0], asOf: month(rows[0].asOf, now) };
}

async function readSource(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetcher(url, {
    headers: { 'User-Agent': 'Dorit-Calculators/1.0 (+https://dorit.bot)' }, signal,
  });
  if (!response.ok || !response.body) throw new Error(`Calculator source returned ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2_000_000) throw new Error('Calculator source response is too large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** All sources must validate together; a failed refresh must leave the last good data intact. */
export async function fetchCalculatorMarketData(options: {
  fetcher?: typeof fetch;
  now?: Date;
  signal?: AbortSignal;
} = {}): Promise<CalculatorMarketData> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const signal = options.signal ?? AbortSignal.timeout(8_000);
  const [policyBytes, workbook, cpiBytes] = await Promise.all([
    readSource(CALCULATOR_DATA_SOURCES.policy, fetcher, signal),
    readSource(CALCULATOR_DATA_SOURCES.mortgage, fetcher, signal),
    readSource(CALCULATOR_DATA_SOURCES.cpi, fetcher, signal),
  ]);
  const rawPolicy = object(JSON.parse(strFromU8(policyBytes)) as unknown);
  const policy = {
    value: number(rawPolicy['currentInterest'], 0, 30) / 100,
    asOf: date(rawPolicy['lastPublishedDate']),
    nextDecision: date(rawPolicy['nextInterestDate']),
  };
  if (Date.parse(policy.asOf) > now.getTime()
    || Date.parse(policy.nextDecision) < now.getTime() - 7 * 86_400_000) throw new Error('Stale policy-rate publication');
  const mortgage = parseMortgageWorkbook(workbook, now);
  const inflation = parseCalculatorInflation(JSON.parse(strFromU8(cpiBytes)) as unknown, now);
  const historyUrl = new URL(CALCULATOR_DATA_SOURCES.policyHistory);
  const [year, m] = mortgage.asOf.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year!, m!, 0)).toISOString().slice(0, 10);
  historyUrl.search = new URLSearchParams({
    'c[SERIES_CODE]': 'MNT_RIB_BOI_D', format: 'csv', startperiod: mortgage.asOf + '-01', endperiod: lastDay,
  }).toString();
  const primeReference = parsePolicyReference(strFromU8(await readSource(historyUrl.toString(), fetcher, signal)), mortgage.asOf);
  const rates = Object.fromEntries(Object.entries(mortgage.effectiveRates)
    .map(([type, value]) => [type, effectiveToNominalRate(value)])) as MortgageTrackRates;
  // This is an inferred discount, not a published contractual spread. Use the reporting
  // month's policy rate, never today's rate, or a policy decision would invent a new discount.
  rates.prime -= primeReference.value + CALCULATOR_PRIME_MARGIN;
  return validateCalculatorMarketData({
    schemaVersion: 1, checkedAt: now.toISOString(), policy,
    mortgage: { ...mortgage, rates, primeReference }, inflation,
  });
}
