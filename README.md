# Israeli rent vs. buy calculator

[![CI](https://github.com/dorit-bot/rent-vs-buy-calculator/actions/workflows/ci.yml/badge.svg)](https://github.com/dorit-bot/rent-vs-buy-calculator/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A TypeScript engine that compares renting with buying a home in Israel, published so anyone can
review the formulas and assumptions.

## How it works

- Both households start with the same cash. The buyer spends it on a down payment and purchase
  costs; the renter invests that full amount. Each month, the household spending less invests
  the difference. Investment returns compound before that month's contribution.
- Buying uses a Spitzer mortgage in one of the uniform baskets. The baseline holds opening
  interest rates constant and applies the chosen CPI path to linked tracks.
- Rent and insurance change annually. Ownership costs use the property's value at the start
  of each year. Investment returns and property appreciation compound monthly.
- At each year-end the buyer's wealth assumes a sale: selling costs, remaining mortgage, and
  modeled land-appreciation tax are deducted. Portfolio gains are taxed above a CPI-indexed basis.
- Purchase tax, VAT, broker fees, and the simplified single-home/additional-home land-appreciation
  tax model are defined in the source. Individual eligibility, exemptions, and tax circumstances
  are outside this model.
- The first break-even year is the first sampled year-end when buying is ahead. A later reversal
  is reported separately. The headline treats a gap within the larger of ₪1,000 or 0.1% of the
  initial price as a tie. Break-even rent is solved numerically at the chosen horizon and may be null.
- Moving costs, rent deposits, early repayment fees, refinancing, and personal tax exceptions
  are excluded.

All amounts are shekels and rates are decimal fractions (`0.05` means 5%). This is a scenario
model for comparing assumptions, not a bank offer or financial advice.

## Data sources

The default rates come from the Bank of Israel's average new-mortgage rates by track and its
policy rate; the default inflation assumption comes from the Central Bureau of Statistics' annual
CPI change. `src/calculatorMarketData.json` is a snapshot of these sources with each one's
observation date. Run `npm run refresh:data` to fetch and validate them yourself; a refresh that
fails validation leaves the snapshot unchanged.

Mortgage averages are published as effective annual rates and converted to nominal annual rates.
The prime discount is inferred using the reporting month's closing policy rate. Variable-rate
averages cover different reset periods. These are starting points, not individual bank offers.
Observed inflation is an editable assumption for future years, not a forecast. Tax brackets
and lending limits are constants in the source, not live data; growth, return, and fee
assumptions remain scenario inputs.

## Explore the code

Read the [comparison](./src/rentVsBuy.ts), [mortgage calculation](./src/mortgage.ts), and
[purchase-tax calculation](./src/purchaseTax.ts). Each has tests alongside it. To run the
[worked example](./examples/basic.mjs) with Node.js 24 or newer:

```sh
npm ci
npm run example
```

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for how changes
reach this repository.

## License

[MIT](./LICENSE).
