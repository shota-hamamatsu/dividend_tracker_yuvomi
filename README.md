# dividend_tracker_yuvomi

A dividend tracker module for [yuvomi.cloud](https://github.com/ulsklyc/yuvomi). It is a dividend ledger the whole family can share.

See the [latest release](https://github.com/shota-hamamatsu/dividend_tracker_yuvomi/releases/latest) for what changed in each version.

## Features

- **Holdings list** — record each stock by holder, ticker, name, share count and currency. Click a row to edit it in a dialog, or delete it with the × button.
- **Multiple pay dates** — up to 24 pay dates (month and day) per stock, each with its own dividend per share.
- **Server-side amounts** — each payment is shares × dividend per share, computed by the sidecar.
  - JPY: dividend per share up to 2 decimal places, floored to 1 yen.
  - Other currencies: up to 4 decimal places, floored to 1 cent (1/100).
- **10 currencies** — JPY, USD, EUR, GBP, AUD, CAD, CHF, HKD, CNY and SGD. There is no currency conversion: totals and charts are shown per currency.
- **Current total** — one year of dividends from the current records, per currency.
- **Yearly totals** — choose a year and register the current total for everyone as that year's total. A registered year is replaced only after confirmation.
- **Charts** — dividends by month, and registered totals for the last 12 years. Bars are stacked by holder, with tooltips and a legend. With two or more currencies, a currency picker switches both charts.
- **Holder filter** — show the list, total and charts for one family member.
- **Permissions** — members can add and edit only their own records. Admins can edit everyone's. Under yuvomi's Roles & permissions, "read" gives view-only access and "none" hides the module.
- **27 languages** — follows yuvomi's display language, including dates, numbers and amounts. Arabic and Persian are shown right to left. Translations other than Japanese and English are machine-translation quality; please report mistakes in an issue.

## Structure

The module is written in TypeScript and built into a single JavaScript file that yuvomi loads.
yuvomi modules run only in the browser, so the data is stored by a separate service running next to yuvomi (a sidecar), as described in "Modules With A Backend Service" in yuvomi's [MODULES.md](https://github.com/ulsklyc/yuvomi/blob/main/MODULES.md).

| Path | Contents |
| --- | --- |
| `src/logic.ts` | Money calculations and validation (pure functions shared by the UI and the sidecar) |
| `src/index.ts` | The UI (`render(container, context)`) |
| `server/` | The sidecar (Node.js, no npm dependencies), served at `/api/extensions/dividend-tracker/` |
| `modules/dividend-tracker/` | The module yuvomi installs (`module.json`, `style.css`, `locales/`, built `index.js`) |
| `dev/` | A preview page with a mocked yuvomi and sidecar |
| `deploy/` | Docker Compose and Caddy examples |
| `docs/specs/` | Implementation specs |

`modules/dividend-tracker/index.js` is build output, but it is **committed** because installing from a GitHub URL does not run a build. Run `npm run build` after changing the source.

## Development

Requires Node.js 22.12 or later.

```bash
npm install
npm run dev          # Preview page at http://localhost:5173/dev/ (no yuvomi or sidecar needed)
npm run lint         # ESLint
npm run format:check # Prettier (npm run format to fix)
npm run typecheck    # Type check
npm test             # Tests for the logic, sidecar and translation files
npm run build        # Build modules/dividend-tracker/index.js
npm run build:pages  # Build the preview page into dist/ for GitHub Pages
```

The preview page is published to GitHub Pages on every push to main: https://shota-hamamatsu.github.io/dividend_tracker_yuvomi/dev/ (add `?lang=de` and so on to choose a language).

## Installing in yuvomi

You need both the module and the sidecar.

### 1. Run the sidecar

Use `deploy/docker-compose.example.yml` and `deploy/Caddyfile.example` as a starting point, and route `/api/extensions/dividend-tracker/` on yuvomi's origin to the sidecar. **Do not rewrite the path.**

```bash
docker build -f server/Dockerfile -t dividend-tracker-sidecar .
```

| Variable | Default | Description |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | (required) | The yuvomi URL opened in the browser, such as `https://yuvomi.example.com` |
| `YUVOMI_INTERNAL_URL` | `http://yuvomi:3000` | yuvomi as seen from the sidecar |
| `DATA_DIR` | `/data` | Where data is stored. Back up `records.json` |
| `PORT` | `8080` | Port to listen on |

For every request, the sidecar asks yuvomi's `/api/v1/auth/me` who the user is and what they may do, using the browser's cookie. It never touches yuvomi's database (`yuvomi.db`).

### 2. Install the module

- Copy `modules/dividend-tracker/` into yuvomi's `modules/` folder, or
- In settings, use "Add custom module" with `https://github.com/shota-hamamatsu/dividend_tracker_yuvomi/tree/main/modules/dividend-tracker` (requires `MODULES_ALLOW_WEB_INSTALL=true` on the server).

New modules are added disabled and become active once an admin approves them.

### Upgrading

Update the sidecar and the module together. Back up `records.json` first: data from older versions is migrated automatically when the sidecar starts, and once it is saved in the new format, older versions cannot read it.
