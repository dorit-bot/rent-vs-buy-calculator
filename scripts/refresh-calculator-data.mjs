import { rename, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  module: { type: 'string', default: '../dist/calculatorData.js' },
  output: { type: 'string', default: '../src/calculatorMarketData.json' },
} });
const { fetchCalculatorMarketData } = await import(new URL(values.module, import.meta.url).href);
const data = await fetchCalculatorMarketData();
const output = new URL(values.output, import.meta.url);
const temporary = new URL(output.href + '.tmp');
await writeFile(temporary, JSON.stringify(data, null, 2) + '\n');
await rename(temporary, output);
console.log(`Verified policy ${data.policy.asOf}, mortgage ${data.mortgage.asOf}, CPI ${data.inflation.asOf}`);
