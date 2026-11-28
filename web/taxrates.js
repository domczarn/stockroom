'use strict';
// Every UK tax rate and threshold Stockroom uses, in one place, keyed by tax year (6 April to 5 April).
// Update this file when HMRC changes a figure, bump RATES_UPDATED, and add the next year before 6 April.
// Rest-of-UK income tax bands; Scotland differs (the app says so wherever income tax is estimated).
const RATES_UPDATED = '2026-11-28';
const TAX_RATES = {
  '2026-27': {
    personalAllowance: 12570, allowanceTaperFrom: 100000,
    basicRateLimit: 50270, higherRateLimit: 125140,           // total-income band tops
    incomeTax: {basic: .20, higher: .40, additional: .45},
    class4: {lower: 12570, upper: 50270, main: .06, above: .02},
    dividend: {allowance: 500, basic: .1075, higher: .3575, additional: .3935},
    corporationTax: {small: .19, main: .25, lower: 50000, upper: 250000, fraction: 3 / 200},
    tradingAllowance: 1000,
    mileage: {first: .45, after: .25, threshold: 10000},
    useOfHomeWeekly: 6,
    vatThreshold: 90000,
    platformReporting: {sales: 30, euro: 2000, gbp: 1700},    // per calendar year
    mtd: [{from: '2026-04-06', income: 50000}, {from: '2027-04-06', income: 30000}, {from: '2028-04-06', income: 20000}],
    taxPot: {ltd: 19, sole: 27},
  },
  '2027-28': {
    personalAllowance: 12570, allowanceTaperFrom: 100000,
    basicRateLimit: 50270, higherRateLimit: 125140,
    incomeTax: {basic: .20, higher: .40, additional: .45},
    class4: {lower: 12570, upper: 50270, main: .06, above: .02},
    dividend: {allowance: 500, basic: .1075, higher: .3575, additional: .3935},
    corporationTax: {small: .19, main: .25, lower: 50000, upper: 250000, fraction: 3 / 200},
    tradingAllowance: 3000,                                   // trebled from 6 April 2027
    mileage: {first: .45, after: .25, threshold: 10000},      // check before April 2027: the simplified rate above 10,000 miles was announced at 35p
    useOfHomeWeekly: 6,
    vatThreshold: 90000,
    platformReporting: {sales: 30, euro: 2000, gbp: 1700},
    mtd: [{from: '2026-04-06', income: 50000}, {from: '2027-04-06', income: 30000}, {from: '2028-04-06', income: 20000}],
    taxPot: {ltd: 19, sole: 27},
  },
};
// Tax year label for a start year, e.g. 2026 -> '2026-27'.
const taxYearKey = start => start + '-' + String((start + 1) % 100).padStart(2, '0');
// Rates for the tax year that starts in `start`; falls back to the nearest year we have.
function ratesFor(start) {
  const key = taxYearKey(start);
  if (TAX_RATES[key]) return TAX_RATES[key];
  const keys = Object.keys(TAX_RATES).sort();
  return TAX_RATES[key < keys[0] ? keys[0] : keys.at(-1)];
}
// Rates for the tax year a date (YYYY-MM-DD) falls in.
function ratesOn(day) { const y = Number(day.slice(0, 4)); return ratesFor(day.slice(5) >= '04-06' ? y : y - 1); }
if (typeof module !== 'undefined') module.exports = {TAX_RATES, RATES_UPDATED, ratesFor, ratesOn, taxYearKey};
