# Shine Options — architecture and contracts

Product options app (working name "Product Options by Techearty"). This file is the contract between
the four parts of the app. Change it first when a contract changes.

```
 Admin (React Router + Polaris web components)        Storefront (theme app extension)
 ├─ option sets, builder, assignment, analytics        ├─ app block: fields rendered by Liquid at first paint
 ├─ Prisma DB = source of truth                        ├─ app embed: fallback injection + quick-add guard
 └─ publishes  ─────────────►  product metafields  ◄───┴─ shine-options.js: live price, validation, properties
                               $app:options (full)            │
                               $app:pricing (lean)            ▼ properties[_shine_options] + visible properties
                                       │              Cart ──► Cart Transform Function (extensions/pricing)
                                       └─────────────────────► Validation Function (extensions/checkout-validation)
```

No part of the shopper's path calls our server to price anything. The only storefront → server calls are
file uploads (through the app proxy).

## Shared core

`shared/options-core.js` holds every rule: conditions, pricing, validation, the cart property encoding and
the lean Function set. Everything imports it; nothing re-implements it. Tests: `npm run test:core`.

`shared/templates.js` holds the five setup templates (Engraving, Gift wrap, Bakery, Custom size, Warranty).

## Option set JSON (`OptionSet`)

```jsonc
{
  "id": "clx123",            // OptionSet.id in our DB
  "v": 3,                    // version, +1 on every publish
  "name": "Engraving",
  "defaultLocale": "en",     // shop primary locale
  "fields": [
    {
      "id": "f_ab12cd",      // stable short id
      "type": "text",        // text|textarea|number|dropdown|radio|checkbox|checkbox_group|toggle|buttons|color_swatch|image_swatch|date|file|contact
      "label": { "en": "Monogram", "fr": "Monogramme" },
      "help": { "en": "Up to 3 letters" },          // optional, also used as tooltip
      "placeholder": { "en": "ABC" },               // optional
      "required": true,
      "condition": { "action": "show", "match": "all",
                     "rules": [{ "source": "field", "field": "f_x", "op": "not_empty" },
                               { "source": "variant", "op": "is", "value": "gid://shopify/ProductVariant/1" }] },
      "price": { "type": "per_char", "amount": 5 },  // non-choice fields; see PRICE_TYPES_BY_FIELD
      "scope": "item",                              // "item" (scales with qty) | "line" (once per cart line)
      "values": [                                    // choice fields only
        { "id": "v_gold", "label": { "en": "Gold" }, "price": 5, "priceType": "fixed",
          "color": "#d4a017", "image": "https://cdn…", "default": true }
      ],
      "settings": { }                                // type-specific, see below
    }
  ]
}
```

Prices are decimals in the **shop currency**. All computed amounts are integer minor units of the
**presentment currency**; fixed prices are converted with the presentment rate and rounded per currency.

| type | settings | answer shape |
| --- | --- | --- |
| text | minLength, maxLength, charset (any/letters/numbers/alphanumeric) | string |
| textarea | maxLength, maxLines | string |
| number | min, max, step | number |
| dropdown, radio, color_swatch, image_swatch | (image_swatch: changeImage) | value id |
| buttons | multiple | value id, or value id[] when multiple |
| checkbox_group | minSelect, maxSelect | value id[] |
| checkbox, toggle | defaultOn | true |
| date | leadDays, blockedDates[], weekdays[] (0=Sun), maxDaysAhead | "YYYY-MM-DD" |
| file | fileTypes (jpg/png/pdf), maxFiles | file URL[] |
| contact | format (email/phone) | string |
| font_picker | values[].font (CSS font stack) | value id |
| product_list | multiple; values[] = { variantId, productId, label, price (shop currency, refreshed on publish), image } | value id, or value id[] when multiple |
| range | min, max, step, unit, default | number |
| dimension | unit, minWidth, maxWidth, minHeight, maxHeight; price type `per_area` = rate × width × height | [width, height] |
| time | start "HH:MM", end "HH:MM", interval (minutes); slots = `timeSlots(field)` | "HH:MM" |
| color_picker | default | "#rrggbb" |
| heading, paragraph, divider, spacer, popup | display only (`text`, `title`, settings.size/height/image) | none |
| group | display only; label = title; collapsible, collapsed. Options after it belong to it until the next group: a hidden group hides, un-requires and un-prices them | none |
| design_layer | display only; sourceField (text/textarea id), fontField (font_picker id), colorField (color_picker/color_swatch id), font, color, x, y (% of image), size (% of image width), align | none |

Product-list picks are real products: their quote lines carry `variantId`, and the Cart Transform adds each as its own
component (own inventory) at that price; only the remaining add-on amount goes on the hidden add-on variant.

## Metafields (app-owned, declared in `shopify.app.toml`)

| owner | namespace:key | type | content | read by |
| --- | --- | --- | --- | --- |
| Product | `$app:options` | json | full `OptionSet` resolved for that product | theme extension (`product.metafields["$app"].options.value`) |
| Product | `$app:pricing` | json | `toFunctionSet(set)` (one language, no presentation) | both Functions |
| Shop | `$app:config` | json | storefront config (below) | theme extension (`shop.metafields["$app"].config.value`) |
| CartTransform | `$app:config` | json | `{ "addonVariantId": "gid://…", "pricingPaused": false }` | pricing Function |
| Validation | `$app:config` | json | `{ "pricingPaused": false }` | validation Function |

Shop `$app:config`:

```jsonc
{
  "pricingPaused": false,        // Free plan limit reached: show options without prices, never charge
  "uploadUrl": "/apps/shine-options/uploads",  // app proxy path (storefront-relative)
  "maxUploadMb": 5, "maxFiles": 1,             // plan limits
  "strings": { "fr": { "required": "Veuillez ajouter {field} pour continuer." } }, // merchant overrides per locale
  "rollout": { "v2Renderer": false }           // flags (data, not code)
}
```

## Cart line properties

The storefront writes, inside the product form:

- `properties[_shine_options]` = `encodeSelection(set, effectiveAnswers(...))` → `{"s":setId,"v":version,"a":{fieldId:answer}}`.
  Hidden (underscore) property. **The Functions price only from this plus the product metafield.**
- One visible property per answered visible field: `properties[<label in shopper locale>] = <display value>`
  (`displayEntries()`). Toggles/checkboxes show "Yes"; files show their links.

## Pricing (Cart Transform, path A from the PRD)

For each line with `_shine_options` and a `$app:pricing` metafield, no selling plan, and pricing not paused:
`quoteAddons()` → if the add-on total is above zero, `lineExpand` the line into

1. the original variant at `cost.amountPerQuantity` (fixedPricePerUnit), with `attributes` = the visible choices
   in the store's default language (canonical copy for fulfillment), and
2. the hidden add-on variant (`addonVariantId`) at `unitAddonMinor()` per unit, with attributes listing each
   priced choice.

The cart keeps one line (the product), priced base + add-ons. `lineUpdate` (Plus only) is never used.
`blockOnFailure: true` by default: if the Function fails, checkout is blocked (never undercharge). Settings can
switch this to "allow base price".

## Validation Function

Blocks checkout when a product with an option set has: a required visible field missing, a value that is not
in the set (`invalid_value`), any other rule broken (length, format, date rules using `shop.localTime.date`),
or a selection made against a different option set than the product has now. Messages follow the PRD copy.

## Uploads

1. Storefront `POST {uploadUrl}` (app proxy, HMAC-verified) with JSON `{ fileName, contentType, size, productId, fieldId }`
   → `{ id, uploadUrl, headers, fileUrl }` or `{ error }` (limits by plan: type, size, count).
2. Browser `PUT`s the bytes straight to `uploadUrl` (S3/R2 presigned URL, or the app's local storage driver in dev),
   with progress.
3. `POST {uploadUrl}/{id}/complete` → server checks the real file type from its first bytes, then
   `{ ok: true, fileUrl }`. `fileUrl` is a signed, private link served by the app; it goes into the answer.

## Limits and deviations from the PRD

- **Functions are JavaScript, not Rust.** No Rust toolchain was available, and JS lets the Functions import
  `shared/options-core.js` directly. Measured cost: about 0.9M instructions per personalized line for 5-field sets.
  The Validation Function caps a checkout at `maxOptionLines` (8, from the Function config) with a clear message,
  so a big cart never reaches an opaque pricing failure. The PRD's 100-line × 20-field target needs a Rust port
  and a leaner Function input.
- **Storefront assets are split.** The block and embed schemas load only a 1.9 KB guard script. The product bundle
  and the date and upload widgets load through deferred script tags only where needed. Worst case is 14.7 KB
  gzipped, against a 20 KB budget.
- **Upload error codes** returned by the server are `wrong_type`, `too_large` and `rate_limited`.
- **Billing** uses Shopify App Pricing (hosted plan page). The app mirrors the plan from
  `app_subscriptions/update` and `currentAppInstallation`.
- **Hidden fields** reset to their default value, not to empty. Their prices are still removed.

## Data (Prisma)

`ShopSettings`, `OptionSet` (+ `OptionSetVersion` per publish), `Upload`, `DailyStat`, `ProcessedOrder`,
`AuditLog`, `SyncJob`. SQLite in development; Postgres in production (change the datasource provider).
