# Contributing

Thanks for taking a look. This repository publishes the calculation engine behind
[Dorit's rent vs. buy calculator](https://dorit.bot/rent-vs-buy), so it is the same code the page uses.

## Issues

Open an issue for a wrong result, an outdated rule or rate, or an unclear assumption. A minimal
input that reproduces the problem, with the result you expected and its source, helps most.

## Pull requests

Pull requests are welcome. Changes are made first in the codebase behind dorit.bot and then
published here, so an accepted pull request is applied there and arrives in a later commit; the
pull request itself is closed rather than merged.

Before opening one, add or update a test in `src/` for any change in behavior and run:

```sh
npm ci
npm run check
```
