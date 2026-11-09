# Shine Options — product options with correct add-on prices

Product options app for Shopify (working name "Product Options by Techearty"). Merchants add custom fields to
product pages (text, swatches, toggles, dropdowns, file upload, date and more) and charge add-on prices such as
"Gift wrap +$5". Shopify Functions set every add-on price, so the browser never decides what the shopper pays.

Built from the product requirement document *Product options app: product requirement document* (2026-11-04).
Architecture and data contracts: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What's in the repo

| Path | What it is |
| --- | --- |
| `shared/options-core.js` | One module for every rule: conditions, pricing, validation, cart-property encoding. Used by the storefront, the admin preview, the server and both Functions. |
| `shared/templates.js` | The five setup templates: Engraving, Gift wrap, Bakery, Custom size, Warranty. |
| `app/` | Embedded admin (React Router + Polaris web components), webhooks, upload endpoints. |
| `extensions/pricing` | Cart Transform Function (JS). Expands a priced line into the product plus a hidden add-on variant priced by the option set (PRD path A, `lineExpand`). |
| `extensions/checkout-validation` | Cart and Checkout Validation Function (JS). Blocks missing required choices, unknown values, broken rules, replaced option sets, and carts over the personalized-line limit. |
| `extensions/product-options` | Theme app extension: app block (fields rendered by Liquid at first paint) and app embed (fallback and quick-add guard). |
| `storefront/` | Source of the storefront scripts, bundled into the theme extension's `assets/` by `npm run build:storefront`. |
| `prisma/schema.prisma` | Settings, option sets and versions, uploads, daily stats, audit log, sync jobs, product assignments. |

## Run it

```sh
npm install
npm run dev          # builds the storefront bundle, then `shopify app dev`
```

During `shopify app dev`, open the app in your dev store. On first load it creates the hidden add-on product,
registers the Cart Transform and Validation, and writes the configuration metafields. The welcome screen then
walks through template → edit → assign → turn on in theme → built-in cart test.

Run `npm run dev:storefront` in a second terminal to rebuild the storefront bundle while you edit `storefront/`.

### Environment variables

| Variable | Needed for |
| --- | --- |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES` | Set by the Shopify CLI in development. |
| `SHOPIFY_APP_HANDLE` | The app handle used for the hosted plan selection page (default `shine-options`). |
| `FILE_LINK_SECRET` | Signs private upload links (falls back to `SHOPIFY_API_SECRET`). |
| `UPLOAD_DIR` | Local upload folder in development (default `./storage/uploads`). |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT` | Production uploads to S3 or Cloudflare R2 (`S3_REGION=auto` and `S3_ENDPOINT` for R2). The bucket's CORS must allow `PUT` from storefront origins. |

### Scripts

| Command | Does |
| --- | --- |
| `npm test` | Core, storefront and both Function test suites. |
| `npm run test:core` / `test:storefront` / `test:functions` | One suite. |
| `npm run build:storefront` | Bundles `storefront/` into the theme extension (prints sizes against the budgets). |
| `npm run lint`, `npm run build` | Lint and production build of the admin. |
| `npm run deploy` | Builds the storefront and runs tests first (`predeploy`), then `shopify app deploy`. |

## PRD coverage (v1 features)

| ID | Feature | Status |
| --- | --- | --- |
| F1 | Option set builder | Field list with drag-and-drop and move buttons, settings panel, live preview (desktop and phone), duplicate, archive, versioned publish. |
| F2 | 14 field types | All 14, plus font picker, product list (real add-on products with their own inventory), range slider, dimension (price per area), time picker, color picker, option group, design layer (text on the product image), modal popup, heading, paragraph, divider and spacer — in the builder, preview, storefront and Functions. |
| F3 | Assignment rules | Product, collection, tag, type, vendor or all products; priority; matched-product preview; "check a product" shows which rule applied; new and edited products pick up their set through webhooks. |
| F4 | Conditional logic | Show or hide by earlier fields or the selected variant. Hidden fields are never required or priced. |
| F5 | Validation | In the browser, then again at checkout by the Validation Function (covers quick add and Buy it now bypasses). |
| F6 | Add-on pricing | Fixed, percent, per character, per unit; per item or once per line (spread across quantity and rounded up, never undercharged). |
| F7 | One-line cart | `lineExpand`: the product keeps one cart line; the add-on amount rides on a hidden component. |
| F8 | Storefront rendering | App block, app embed fallback, quick-add guard, Buy it now interception. No theme file writes, no script tags. |
| F9 | File upload | Direct signed upload (local or S3/R2), type checked from file content, plan size and count limits, private signed links on the order, about 180-day retention. |
| F10 | Date rules | Lead time, blocked dates, weekdays, max days ahead, in the store's time zone (also enforced at checkout). |
| F11 | Templates and setup wizard | Five templates, "What do you sell?", setup checklist, built-in cart test through a real Storefront API cart. |
| F12 | Order display | Choices as line item properties; canonical copy in the store language on the product component; packing slip snippet in Settings. |
| F13 | Languages and currency | Labels and storefront text per store language; prices converted to the shopper's currency. |
| F14 | Add-on analytics | Revenue by set, field and value, most chosen values, date range, CSV export, refunds subtracted (Growth plan). |
| F15 | Import, export, bulk assign | CSV export and import (round trip verified identical), multi-select product and collection assignment. |
| F16 | Plans and billing | Shopify App Pricing (Shopify-hosted plan page), Free plan limit of 50 add-on orders a month with pause and upgrade prompt. |

## Known gaps and decisions to make

1. **Function speed is below the PRD target.** The PRD asks for a 100-line cart with 20 fields per line. The JS
   Functions handle about 8 personalized lines of 5 fields (pricing ~8.1M of Shopify's 11M instructions). Past
   that, the Validation Function stops checkout with "You can check out up to 8 personalized items at a time"
   instead of an opaque failure. Rust (what the PRD specifies) is the fix, but it isn't installed here. Shopify's
   128 kB Function input limit also caps per-line option-set data, whatever the language, so 20-field sets need
   a leaner format too.
2. **Not yet run against a live store.** Everything is unit, integration and build tested, but these need a dev
   store (the PRD's November spike):
   - that `lineExpand` component prices work on a non-Plus store;
   - whether the hidden add-on product must be published to the Online Store;
   - how component attributes show on orders and packing slips;
   - the payment and discount matrix.
3. **Malware scanning** of uploads isn't implemented. There's a marked hook in
   `app/routes/proxy.uploads_.$id.complete.jsx`.
4. **Plans** must be created in the Partner Dashboard (Shopify App Pricing) with the names Starter, Growth and Pro.
   The PRD said "Billing API", but Shopify's current guidance for new public apps is App Pricing; all charges
   still go through Shopify.
5. **Production database** is SQLite in development. Switch the Prisma datasource to Postgres for production.
6. **Not built yet:**
   - the discounts-on-add-ons merchant setting (its behavior is still to be confirmed in the spike);
   - flag-driven staged rollouts (the `rollout` field exists in the shop config);
   - a nightly theme check (the app checks on Home and Settings load);
   - error tracking and monitoring.
7. **Protected customer data**: the `orders/create` and `refunds/create` webhooks are commented out in
   `shopify.app.toml` until you request access (Partner Dashboard > Apps > shine-options > API access requests >
   Protected customer data access > select Protected customer data, no name/email/phone/address fields). Until then,
   add-on analytics and the Free plan's monthly counter don't update.

Framework details from the Shopify app template (React Router, Prisma, deployment): [docs/SHOPIFY-TEMPLATE-README.md](docs/SHOPIFY-TEMPLATE-README.md).
