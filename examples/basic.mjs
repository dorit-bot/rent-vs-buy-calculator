import { calculateRentVsBuy, RENT_VS_BUY_DEFAULTS } from '../dist/index.js';

const result = calculateRentVsBuy(RENT_VS_BUY_DEFAULTS);

// Round shekel amounts to whole numbers; rates such as 0.07 stay as they are.
const readable = (key, value) => (typeof value === 'number' && Math.abs(value) >= 1 ? Math.round(value) : value);

console.log(JSON.stringify({
  horizonYears: result.horizonYears,
  upfrontCash: result.upfront.total,
  firstMonth: result.firstMonth,
  verdict: result.verdict,
  breakEvenYear: result.breakEvenYear,
  breakEvenRent: result.breakEvenRent,
  returnSensitivity: result.returnSensitivity,
}, readable, 2));
