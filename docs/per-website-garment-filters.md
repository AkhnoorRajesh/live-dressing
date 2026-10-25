# Per-website garment filters

**Relevant commits:** this change is uncommitted at time of writing. The UGG policy was ported from the standalone demo repo `anywear-ugg-demo`: `7e01344` (vendored baseline, `feat/vlm-prefilter @ 112d6fe`) · `69f9228` (UGG merchant gate).
**Relevant files:** `per_website_garment_filter.js` (the bridge) · `revolve.js` · `ugg.js` · `guess.js` · `loropiana.js` · `_garmentFilterRejects` / `_galleryAllowedCached` / `_isTryOnableImage` / `findTryOnableProductImage` / `sendReferenceImage` / `_isProductPageCached` in `widget-core.js` · `scripts/check.mjs` §11, §12, §13, §13b, §13d, §14

---

## The problem

Some retailers sell far more than a torso try-on can render. On those sites the generic "is this a product image?" rules in `_isTryOnableImage()` are not enough — a jeans tile on Revolve and a boot tile on UGG are both, correctly, product images. Something has to know the retailer's catalogue.

That knowledge is per-retailer, high-churn, and worthless everywhere else, so it lives in one file per site and never in `widget-core.js`.

---

## Architecture

```
widget-core.js  ──►  per_website_garment_filter.js  ──►  revolve.js  (DecartRevolve)
                          (DecartGarmentFilter)      ├─►  ugg.js      (DecartUgg)
                                                     ├─►  guess.js    (DecartGuess)
                                                     └─►  loropiana.js (DecartLoroPiana)
```

`widget-core.js` names no retailer. One function — `_garmentFilterRejects()` — is its entire surface, and `per_website_garment_filter.js` is the only file that names an individual retailer's global.

### Why a bridge rather than direct calls

Each site filter costs widget-core three call sites: the button predicate, the PDP image resolver, and delivery. Each needs its own `typeof` guard, because these files are absent on any store without a filter. One retailer made that tolerable. It grows at three guards per retailer, and a forgotten guard is not a crash — it is Try-On buttons silently reappearing on merchandise the model cannot render.

`check.mjs` §11 fails the build if widget-core references `DecartRevolve`, `DecartUgg` or `DecartGuess` directly.

### The adapter contract

Required:

| Member | Returns | Meaning |
|---|---|---|
| `applies()` | boolean | true on that retailer's hosts only |
| `isSupportedGarment(ctx)` | boolean | true = show Try-On. `ctx` is `{ imageUrl, imgEl, pageUrl, isProductPage }`; the first three may be null |

`isProductPage` is the **widget's own** product-page verdict, computed by `widget-core` (`_isProductPageCached()`, which honours a merchant's `options.isProductPage` and in the extension is `content.js`'s stricter detector) and handed to the filter. A filter that scopes a retailer to its PDPs reads it; it must not re-derive it. A second copy of the JSON-LD walk inside a site file would drift from the one the rest of the widget acts on, with no owner. It is `undefined` only if that wiring breaks — see the Guess section.

Optional, feature-detected by the bridge:

| Member | Returns | Meaning |
|---|---|---|
| `canonicalImageUrl(url)` | string | rewrite the URL actually delivered to the fitting room |
| `applyPageFixes()` | void | one-off CSS for that retailer's layout |
| `singleImageOnly()` | boolean | send the one chosen image, never a stitched front+back pair (`uniqlo.js`, `loropiana.js`) |
| `buttonOnEveryGalleryView()` | boolean | lift the PDP cap of two gallery views with a button (`uniqlo.js`) |
| `buttonOnFirstGalleryViewOnly()` | boolean | tighten it to ONE: the gallery's first view in document order (`loropiana.js`) |

At most one filter applies on any host. A filter that throws fails **open** — refusing every image because one regex blew up is a silently dead extension on that retailer, strictly worse than an unfiltered one.

---

## Two different questions

The two filters look alike and are not asking the same thing.

**`revolve.js` asks the shopper's question:** *can this garment be tried on?* Dresses and tops yes; jeans, shoes, bags no. The category is encoded in the style code (`1STR-WD248_V1.jpg` → `D`), read from the asset filename, the card's `/dp/CODE/` link, or the page URL.

**`ugg.js` asks the merchant's question:** *does this try-on sell UGG's product?* UGG is a shoe company and the torso try-on cannot render a boot, so **the entire core catalogue is blocked** and the apparel line is what remains. Read the `FOOTWEAR` set as policy, not as a bug.

Both fail closed on an unrecognised category. Neither can enumerate what the retailer adds next, and "unknown" must never mean "probably fine".

---

## UGG: ordering is load-bearing

The category is the **first path segment** of every product link — nothing else carries it. Image URLs are opaque SKUs, alt text is marketing copy, there is no JSON-LD.

```
/women-boots/classic-ultra-mini/1116109.html
 ────┬─────  ──────┬──────────  ───┬───
category      product slug        SKU
```

`verdict()` runs its branches in an order that was established by live misclassifications. Both of these are one reorder away from returning:

1. **Item-name block runs first, against the whole path.** Socks, gloves, mittens and scarves are merchandised under plain apparel segments. `/women-apparel/braylee-uggisle-scarf/106212.html` is allowed by the apparel branch if this does not run first.
2. **Apparel matches before footwear tokenisation.** A segment like `women-apparel-boot-cut-pants` contains the token `boot` and tokenises as footwear if step 4 runs first.

The same item-name regex is also tested against the tile's `alt`/`title`, which carries the product name on UGG ("Kyro Cozy Crew Sock"). That keeps socks blocked where the wrapping link is absent, absolute, or non-canonical — DOM shapes a path-only check misses.

`check.mjs` §13 pins both ordering rules as fixtures.

### PDP galleries

On a supported PDP the button belongs on the on-model views, not the fabric close-ups. UGG's studio pattern is that close-ups come **last** — verified across 13 apparel PDPs, 11 of which follow it. The two that do not are pinned by SKU in `MEASURED_VIEW_EXCEPTIONS`.

These are measured values from looking at every view of those two galleries, not a rule. **A third exception means re-checking the assumption, not adding a third entry.**

When the gallery cannot be measured (no DOM), position falls back to allowing. Position is a refinement; it must never be the thing that grants or denies a button on its own.

---

## `canonicalImageUrl` — a mutation, deliberately separate

UGG's PLP tiles swap to the `_2` back view on hover, and the swapped element can win the click-time URL race, so the reference image becomes whichever view the cursor triggered. `ugg.js` forces the view digit to `1`.

**Why not the existing hover machinery.** `widget-core` already has `_hoverSafeImgUrl` and first-img-in-parent (see `drag-flip-on-hover.md`). Those recover the *resting* URL for the element the user hovered, and they run only on the button-click path. `canonicalImageUrl` runs in `sendReferenceImage()`, the funnel every delivery path passes through — including PDP auto-start and SPA navigation, which have no hovered element to correct.

**It must run first.** `sendReferenceImage()` derives `_referenceImageUrl`, the prefetched image hash, and the `_tryonContext` attribution record from the URL. Rewriting afterwards leaves the hash and the recorded try-on pointing at a different view than the session actually runs on. `check.mjs` §11 asserts the ordering, not just the presence.

**Known consequence, accepted.** On a PDP this also rewrites a gallery view the shopper deliberately clicked. `isSupportedGarment()` decides where the *button* appears across gallery views; `canonicalImageUrl` decides what is *delivered*, and it is always view 1. So `MEASURED_VIEW_EXCEPTIONS` controls button placement only. If that ever needs to change, it is one line in `ugg.js`.

**Open question, not yet answered:** nobody has checked whether ugg.com's cards are the two-stacked-img pattern or the JS src-swap pattern, or whether the resting front image is always `_1`. If it is, the two mechanisms agree on the hover path and this rewrite earns its place only on the element-less paths. Worth 10 minutes on a live PLP before anyone extends either mechanism.

---

## Guess: a page filter, not a catalogue filter

### ✅ ON again (2026-10-08): the 54 reviewed "Yes" products

👉 **The list is `PILOT_SKUS` in `guess.js`: every row with `Recommend? = Yes` in [`guess-product-review.csv`](guess-product-review.csv)** (54 of 141 products: 48 US, 6 Europe). Maybe (80) and No (7) are not listed. To change the list, add or delete a SKU line. To re-derive it, filter the sheet on `Recommend? = Yes` and take the `SKU` column.

- **Why this list fixes what turned the filter off.** The review judged each product on its *first two gallery images*, which are exactly the pair widget-core stitches as front|back. The first pilot list (top 50 by traffic) assumed one chosen reference image instead, and none of its SKUs are in this list.
- **Colour matters.** Verdicts differ by colour. Madeline `W4BR0NZ3LG0` is Yes in G7N9, G61G and A83G but Maybe in G1O6 and A60W, so only the Yes colours get a button. That is why the key is the full `<STYLE>-<COLOUR>` SKU.
- **Behaviour is unchanged from the pilot:** a button wherever a listed product appears (grids, its PDP, recommendation tiles), nothing else, and the pill hidden.
- **Kill switch:** `GUESS_FILTER_ENABLED` is `true`. Set it to `false` for an unfiltered guess.com, and invert §14b in `check.mjs`.
- **Verified:** the filter agrees with the sheet on all 141 rows.

<details><summary>History: switched OFF 2026-10-04 → 2026-10-08</summary>

The first pilot audit assumed **one chosen reference image per product** ("never back views"). widget-core stitches the first two gallery views as front|back, and on Guess the back is usually view 3 or later (e.g. `W6YB45W5907-A8A8`), so the filter was switched off until a list judged on those two images existed.
</details>

### Pilot mechanics (first shipped 2026-10-03 with a 50-product list, since replaced)

**To add or remove a product, edit `PILOT_SKUS` in `guess.js`.** One line per product, keyed by the SKU from the product URL's file name (`…/oxana-hooded-puffer-coat-black/W4BL61WGLZ0-JBLK.html` → `W4BL61WGLZ0-JBLK`). Current source: [`guess-product-review.csv`](guess-product-review.csv), Recommend? = Yes (see above). The original top-50-by-traffic list is in git history (`docs/guess-pilot-top50.csv`, removed 2026-10-08).

- **The pilot allowlist is the only live rule.** A listed product gets a Try-On button wherever it appears: on a catalogue grid, on search, on its own PDP, and as a "you may also like" tile. Nothing else on guess.com or guess.eu gets a button. Each tile is judged by its own link, so a non-pilot tile on a pilot PDP is still refused.
- **Matched on the SKU alone**, not the full URL. The locale/brand/category/promo segments in front of the SKU vary (`/sale/…`, `/guess-jeans/…`), and Guess re-merchandises products. The `<STYLE>-<COLOUR>` file name is the part that names the product. Colour is part of the SKU: an unlisted colour of a listed style is refused.
- **The generic static initial filtering is commented out.** That is the category gate below (tops and dresses only, blouses refused by slug). Its tables and `verdict()` are kept and still fixture-tested, so re-enabling it means uncommenting one block in `isSupportedGarment()`. It had to be switched off rather than left in front of the allowlist: measured over the 50 pilot URLs it allows 13, refuses 35 as unknown (coats, puffers, jeans, trousers, a skirt) and blocks 2.
- **The product-page-only rule is commented out too** (asked for on 2026-10-03: "just show the button where it is allowed"). It's kept in `isSupportedGarment()` behind a `return true;`, and re-enabling it means deleting that line and uncommenting the block.
- **The pill stays hidden** because `hasCustomFilter()` is still true on guess.com (`_filterOwnsEntry`). Turning off the PDP rule doesn't affect it.
- **Telemetry:** a refusal by the allowlist reports `guess_garment_filtered` with `reason: 'not_in_pilot_allowlist'` (plus `sku`, null off a product URL). The old `category_*` reasons no longer fire while the generic filter is off.
- **guess.eu works too, if the product is sold there.** guess.eu uses the same SKUs under different names and paths. Seen live (2026-10-03): the black Oxana as `/en-dk/…/last-chance/coats-and-jackets/faux-fur-hood-puffer-black/W4BL61WGLZ0-JBLK.html`, and the Ella coat as `/en-de/marciano-by-guess/…/marciano-wool-blend-coat-white/5BGL027125A-MCML.html`. The allowlist ignores the host, so those match with no extra work. Not every pilot SKU is in the EU catalogue: the newest `W6…` styles weren't findable there. Verified only through search indexing, because the dev container cannot reach guess.eu.
- **The `GNA` prefix.** guess.com serves some products under both `W5BLBKW0492-JBLK.html` and `GNAW5BLBKW0492-JBLK.html`. A leading `GNA` is stripped as a fallback lookup. It can never admit an unlisted SKU, only the listed one behind it.

Everything below describes the product-page-only rule and the category gate as they worked while they were live. Both are currently commented out.

`guess.js` is the third question the contract can answer, and it is not about the catalogue at all.

**`guess.js` asks: *is the shopper on a product page?*** On guess.com the try-on is offered on PDPs and nowhere else — no buttons on category grids, search, the homepage or editorial, and no floating pill anywhere on the site. There is no garment taxonomy in the file.

### Both halves of that land on machinery that already existed

This is why there is no guess.com branch anywhere in `widget-core.js`:

1. **PDP-only buttons.** The contract is already a per-image veto, and "not a product page" is a perfectly good reason to veto. Returning false everywhere but the PDP *is* the feature.
2. **No pill.** Free. `widget-core` already suppresses the floating pill on any site that has a filter (`_filterOwnsEntry`), on the reasoning that a pill which opens the widget anywhere would ignore the judgement the filter just made. Registering the file is the whole implementation.

Consequence worth stating plainly: on guess.com a shopper on the homepage has **no** way to open the widget. That is the ask, and it is the same single-entry-point doctrine `_filterOwnsEntry` was written for.

### It does not detect the PDP itself

The verdict arrives as `ctx.isProductPage`. This is the one real design decision in the file: the widget already has a product-page detector, it is the one the rest of the widget acts on, and a second copy here would be a slow divergence with no owner. Reusing it inherits the extension's stricter detector, a merchant's override, the 2 s cache, and the re-check after SPA navigation.

`check.mjs` §13b therefore pins **two** things: that `guess.js` returns the right verdict, and that `widget-core.js` still passes `isProductPage: _isProductPageCached()` into `rejects()`. Without the second, `guess.js` sees `undefined` and guess.com quietly returns to site-wide buttons — nothing throws and no other check notices.

### It fails OPEN, unlike its siblings

`revolve.js` and `ugg.js` fail closed on an unrecognised category, because theirs is a *product* judgement and "unknown" must never mean "probably fine".

An absent `ctx.isProductPage` is a different kind of unknown — missing wiring, not an unreadable product — so `guess.js` follows the bridge's infrastructure doctrine instead and fails open. An unfiltered guess.com costs PDP scoping until the wiring is fixed; a fail-closed guess.com would have zero Try-On buttons anywhere. The first is recoverable, the second is a dead extension on the site.

### Measured on live guess.com, 2026-09-18

guess.com is Salesforce Commerce Cloud and **server-renders** its JSON-LD, so the detector's one known weakness — SPAs injecting JSON-LD after `document_idle` — does not apply.

| Page | JSON-LD | Verdict |
|---|---|---|
| `/en-us/guess/women/clothing/tops/cutout-top-white/W6GP52K5120-G011.html` | `@type:Product`, `offers.@type:Offer`, `sku`+`mpn` | **true** |
| `/en-us/guess-jeans/denim/women/.../W4YN56D5CC3-M3DW.html` | same shape (second brand path) | **true** |
| `/en-us/guess/women/clothing/tops` | `ItemList` + `BreadcrumbList` | false |
| `/en-us/guess/women/clothing/dresses-and-jumpsuits` | `ItemList` | false |
| `/en-us/guess/women` (home) | no `Product` node | false |
| `/en-us/search?q=dress` | no `Product` node | false |

The `offers.@type:"Offer"` shape matters: `content.js`'s detector — the one the extension actually uses — rejects a top-level `@type:"Product"` that carries an `AggregateOffer` with no SKU, to catch catalogue pages masquerading as products. Guess passes on the definitive single-product signal, so both detectors agree.

**There is deliberately no URL regex.** The PDP path shape (`/…/<slug>/<STYLE>-<COLOUR>.html`) is consistent, but the site also serves plain content pages ending in `.html` (`privacy-policy.html`, `faq-landing.html`), so a path rule would need a SKU pattern to stay honest — and would still be a second detector.

### Why it was inert when it first landed, and what fixed it

`guess.js` shipped correct and did nothing, because Guess renders its gallery as a `<product-gallery>` Web Component: the five product images live in its **shadow root**, invisible to `document.querySelectorAll('img')`, and the only product image in the light DOM is a hidden 0×0 preload stub. The PDP gating was right; it was gating a page whose images the scanner could not see. Because this filter also suppresses the pill, that left guess.com with no entry point at all.

That turned out not to be a Guess problem — the scanner had no shadow-DOM traversal anywhere, so every Web Component retailer was silently getting nothing. Fixed generally in `_allImgs()` and friends.

→ `docs/shadow-dom-image-scanning.md`

### "Product page only" is two conditions, and it is reusable

A PDP renders far more than its own product, so the policy needs both halves:

| Condition | ctx field | Answered by |
|---|---|---|
| the page is a PDP | `isProductPage` | the JSON-LD product-page detector |
| the image is *that product's* own image | `isPrimaryProductImage` | the first two of the hero size group |

The second exists because the generic default is deliberately the opposite. The note above `_PDP_BUTTON_MAX_GALLERY_VIEWS` says related-product tiles "keep their button exactly as before" — right for most retailers, since a recommendation tile is a real garment someone may want to try. `guess.js` opts guess.com out of that default; nothing changes for anyone else.

**Neither fact is computed in `guess.js`.** It contains no guess.com URL shapes, CDN paths, SKU parsing or DOM selectors, and `check.mjs` §13b fails the build if any appear in its code.

`isPrimaryProductImage` is not a new heuristic either — it is the one the widget already trusts to place gallery buttons. `_heroSizeGroup()` finds the product's views (the hero `findProductImage()` picks, plus everything rendered at the hero's size), and `_primaryProductImages()` returns the **first two in document order** — the exact set `_isExtraGalleryView()` already lets through. So the filter and the gallery rule agree by construction instead of by two rules being kept in sync.

### Why the simplest version is also the robust one

A rail rendered at the hero's exact size *would* join the size group — plausible on a narrow viewport where a rail goes full-width. Taking the first two **in document order** already absorbs that: a gallery precedes its recommendations, so the first two members are gallery views even when foreign tiles are in the group.

A containment pass (climb to the smallest ancestor holding two members, crossing shadow boundaries) was built here and then removed. Measured against a fixture of five adversarial layouts, it bought exactly one synthetic case over the simple rule and cost a second mechanism to keep correct:

| Fixture layout | first-two rule | + containment |
|---|---|---|
| gallery, then smaller rail | ✅ | ✅ |
| gallery, then **same-size** rail | ✅ | ✅ |
| gallery and rail both in **shadow DOM**, same size | ✅ | ✅ |
| **single-image** PDP + same-size rail | 1 stray button | ✅ |
| rail **above** gallery, same size | ✗ | ✗ |

The last row is not a containment problem — there `findProductImage()` picks a rail tile as the hero because it is higher in the viewport, so the product is already misidentified upstream and every other PDP feature is wrong too. Neither version helps, which is the clearest sign the extra mechanism was not paying for itself.

That is what makes the policy portable. **The whole of it is:**

```js
return ctx.isProductPage === true && ctx.isPrimaryProductImage !== false;
```

The next retailer that asks for "product page only" is a new file with those two lines, a host test and its telemetry. Nothing new in `widget-core.js`, and no knowledge of that retailer's markup.

### Which product vs. how many views — two different owners

`guess.js` says **which product**. It does not say how many views of it get a button: `_isExtraGalleryView()` already trims any gallery to its first two views for every retailer, because whichever view you click builds the same reference pair.

Measured on a live guess.com PDP (every `<img>` ≥120×120, shadow roots included):

| | count | size | outcome |
|---|---|---|---|
| the product's own gallery | 5 | 632×948 | admitted here → **2 buttons** after the generic first-two rule |
| "more items" carousels | 30 | 195×292 | refused — 30 other products |
| footer art | 3 | 328×164 | refused (also blocked upstream by the site-chrome rule) |

The split is the point: *which product* is a per-retailer policy and lives in the filter; *how many views of one product* is a generic PDP question already answered once for everyone. Re-deciding it in a site file is the drift these files exist to prevent.

### What it deliberately does not do

It does not judge the image. Every image on a Guess PDP is left to the generic rules, exactly as on the rest of the web. If PDP furniture (the footer lifestyle strip, menu imagery) ever earns a button, the discriminator is already known and belongs in `guess.js`: product shots are `img.guess.com/image/upload/…/<REGION>/Style/ECOMM/<STYLE>-<COLOUR>`, all non-product art is `…/<REGION>/Asset/…`. One line, the day it is needed — and `check.mjs` §13b will ask for a fixture if `canonicalImageUrl` ever appears on the module.

---

## Loro Piana: 20 garments in every colour, one image each (2026-10-15)

👉 **To add or remove a garment:** add or delete its line in `ALLOWED_STYLES` in `loropiana.js`, and its URL in `LISTED` in `check.mjs` §13d. The key is the **style**: the part of the code at the end of the URL before the underscore. The part after it is the colour, and every colour is admitted:

```
https://it.loropiana.com/en/woman/top-and-t-shirts/classic-polo-FAO5738_W000.html
                                                                 └ key ┘ └ colour, ignored
```

### What it does

| Where | Try-On button | Image sent |
|---|---|---|
| Catalogue (category grid, search, any non-product page) | on a tile whose own product link names a listed product | the tile's **front** image alone; the flip/hover image is never stitched beside it |
| Product page of a listed product | **one**, on the **first** gallery image | that image alone |
| "You may also like" on any product page | none, even for a listed product | — |
| Product page of an unlisted product | none | — |
| Another colour of a listed garment | the same as the listed colour: catalogue tile and first image | as above |
| Floating pill | never, anywhere on loropiana.com | — |

It applies on `loropiana.com` and **every subdomain** (`it.`, `us.`, `www.`, none). The products are the same on all of them, so the match is on the code alone. The host, the locale and the path in front of it are never read. The same product appears under `/en/woman/top-and-t-shirts/`, `/en/spring-summer/man/` and `/en/gifting-idea/man/ready-to-wear/`. A full-URL match would drop a product the day Loro Piana re-merchandised it.

### Why it is built this way

- **Every colour of a listed garment**, unlike `guess.js`. Loro Piana gives every colour its own URL (`polo-shirt-FAI1314_516Z.html`, `…_W000.html`). The list arrived as one URL per garment. The ask was then to allow every colour of those 20 garments, so the key is the style and the colour is never read. Guess keys on the full SKU because its review judged each colour's photos separately. To go back to one colour per garment, key on the full `<STYLE>_<COLOUR>` code again. That is a policy change, so make it on purpose.
- **On a product page, a tile for another colour of the same garment is still refused.** The "different product" check compares the full code, colour included, because that tile is not this page's first image.
- **First image only** is two site preferences, not new widget logic. `singleImageOnly()` makes `_compositePair()` resolve null on every path (catalogue click, PDP click, drag), which every caller already reads as "send the image alone". `buttonOnFirstGalleryViewOnly()` makes `_galleryAllowedCached()` return the size group's **first member in document order** instead of the two most visible. `_isExtraGalleryView()` (which views lose the button) and `_primaryProductImages()` (the filter's `isPrimaryProductImage`) both read that one set, so they agree by construction.
- **Document order, deliberately, here only.** §19 explains why every other site ranks by visible area: a translated carousel's first DOM slides are off screen. For Loro Piana the ask is the *first* image. Ranking by visibility would move the single button down a stacked gallery as the shopper scrolls, onto the back view or a fabric close-up, and that view would be the image sent.
- **Recommendation tiles are refused on a product page** by two independent signals. One is `isPrimaryProductImage` (not the first view). The other is the tile's own link naming a different product. The second matters when a rail scrolled into view becomes the hero's size group and so reads as "primary".
- **The auto-grab is refused on a product page** (no element, so not the first view). The only way to start a session on a Loro Piana PDP is a click on the first image.
- **`loropiana.com` is on `content.js` `ALLOWED_DOMAINS`.** The filter only matters if the extension injects. Injection must not hinge on the fashion-site heuristics, which were never checked against the live site.

### What fails silently, and how you would know

- **Not verified against the live site.** loropiana.com was unreachable from the environment this was built in. The behaviour was verified end to end in Chromium, through both the web launcher and the unpacked extension, on mock pages. Those pages had a stacked 4-view gallery, a "you may also like" rail and flip-on-hover catalogue tiles, served on `it.`, `us.` and the bare domain.
- **Measured live since (2026-10-15, `it.loropiana.com`, 1024 px).** The desktop gallery is a two-column grid: Swiper is not initialised at ≥ 992 px. The first view in document order is the hero (`.klcp`, never faded). Gallery boxes are pre-sized by `.lazy__uncollapser--5-7`. The other views start at `opacity:0` until lazysizes marks them loaded, so they are not candidates before then. Below 992 px, where the clone risk below lives, was not measured.
- **Button late or missing after a mid-page reload: fixed generically.** If the gallery guess ran while the page was scrolled past the gallery (Chrome restores the scroll on reload), the first image was refused (`pdp_not_first_view`). Nothing re-checked when the shopper scrolled back. Measured: 5.4 s with no button, or never. A scroll end with the first image back on screen now re-checks it. See docs/pdp-first-image-recheck.md.
- **Button seconds late, or missing, after a colour switch: fixed generically.** A swatch click replaces the gallery with lazysizes placeholders that have no `src`. The guess made on the swap was memoised from a recently-viewed tile. Measured: 2824 ms after the click, or never. An image load now triggers the same re-check, so the button returns 172–287 ms after the swap. Same doc.
- **Looping carousel.** If the PDP gallery is a carousel that **clones its last slide in front of the first** (Swiper ≤ 8 loop mode, slick infinite), "first in document order" is that clone. The button then sits on a hidden copy of the last image. A missing button on a listed PDP should be checked against this first.
- **A missed product page.** The PDP rules need widget-core's product-page verdict (JSON-LD `Product`; in the extension, `content.js`'s stricter detector). If it says "not a PDP", the page is judged like a catalogue. A listed product then keeps buttons on its gallery views rather than losing all of them, but they are no longer capped at one.
- **Telemetry:** `loropiana_garment_filtered`, once per reason per page. `pdp_not_first_view`, `pdp_other_product` and `not_listed` are the ordinary refusals. `pdp_not_listed` on a garment you expected means its style code changed (Loro Piana re-coded it). `pdp_verdict_missing` / `primary_verdict_missing` should never appear in a shipped build.

### Files and testing

| File | Role |
|---|---|
| `loropiana.js` | the list, the host, the PDP/catalogue rules, both preferences |
| `per_website_garment_filter.js` | registers `DecartLoroPiana`; bridges `buttonOnFirstGalleryViewOnly()` |
| `widget-core.js` `_galleryAllowedCached()` | the first-view cap |
| `content.js` `ALLOWED_DOMAINS` | the extension always injects on loropiana.com |
| `manifest.json`, `release.sh`, backend `shopify/public/anywear*.js` | load it in the extension and the web build |

`npm run check` §13d runs every listed URL on three host shapes. It also covers the PDP and catalogue rules, the `ALLOWED_DOMAINS` entry, and the real `_galleryAllowedCached()` on a scrolled 3-view gallery (with and without the preference). §11 and §14 cover wiring and dispatch.

---

## Both contexts: extension *and* web install

These files were originally extension-only, on the reasoning that "a merchant's own store is never revolve.com or ugg.com". That was wrong, and it failed in the worst direction: a retailer with a filter is exactly the retailer most likely to install the widget on its own storefront, and an extension-only filter means Try-On buttons on every boot on ugg.com — the one place the filter matters most.

So all three ship to the web build (`WIDGET_JS_FILES` + `LINT_FILES`), and the launchers fetch them **conditionally**:

```js
var GARMENT_FILTER_HOSTS = /(^|\.)(revolve|ugg|guess)\.com$/i;
```

- ordinary merchant → regex misses → **zero extra requests, zero latency**
- revolve.com / ugg.com / guess.com web install → all filter files fetched in **parallel**, then `widget-core.js`

The three load in parallel because `per_website_garment_filter.js` reads the retailer globals lazily inside its functions — there is no load-order dependency between them, only the requirement that all land before a button is placed.

`onerror` settles the counter exactly like `onload`. A filter that 404s must not stop `widget-core.js` from loading, or we would trade "buttons on boots" for "no widget at all".

All three files are fetched on any filtered host, not just the matching one — the launcher only needs to know *whether* a host has a filter, not which. That trades ~2KB for keeping one regex instead of a host→file map in three launchers.

### The regex is a duplicated fact, and it is checked

`GARMENT_FILTER_HOSTS` is the web half of something the filter files own themselves via `applies()`. If they disagree — a filter claiming a host the launcher regex misses — that filter works perfectly in the Chrome extension and silently never loads on web. Silent in exactly one direction.

`check.mjs` §11 runs each filter's real `applies()` against its canonical host and asserts every launcher regex matches it. Adding a site file without a `SITE_HOSTS` entry fails the check rather than skipping the assertion.

### The guard still cannot be dropped

Shipping to the web does **not** make the global unconditional — the launchers fetch these only on filtered hosts, so on every other storefront `DecartGarmentFilter` genuinely does not exist. `widget-core.js` is shared verbatim with the web build, so an unguarded reference is a `ReferenceError` on every Shopify store, thrown from inside the predicate that decides where Try-On buttons go, i.e. **no buttons anywhere**.

### The performance early-out is not cosmetic

`_garmentFilterRejects()` checks `hasCustomFilter()` before resolving the image URL. Without it, the `_extractImageUrlFromEl` lazy-loader walk runs for every image on every site in the extension, to build a URL the dispatcher immediately discards. The old per-retailer guard got this early-out free from `DecartRevolve.applies()`; the bridge has to ask for it explicitly.

---

## Where the veto sits, and why

`_isTryOnableImage()` calls the veto **above every `return true`**. It was originally written below the shared-tile-size check, which returns true early — and on a category grid every tile shares its rendered size, so the whitelist was bypassed on exactly the pages it exists for. Silent in both directions: nothing errors, buttons just appear on jeans again. `check.mjs` §11 pins the position.

The filter is subtractive only: it can hide a button, never add one. The generic layer remains the sole judge of what counts as a product image, so a retailer's banner showing a dress still loses its button to the geometry rules rather than winning one from the whitelist.

`findTryOnableProductImage()` is a wrapper over `findProductImage()` rather than a change to it, because `findProductImage()` also feeds add-to-cart attribution — which must keep reporting the real product even on a page whose garment we do not offer. Filtering it there would quietly put holes in the attribution data.

---

## Adding another retailer

1. Write `<site>.js` exposing `applies()` and `isSupportedGarment(ctx)`. No `chrome.*`.
2. Register it in `_registered()` in `per_website_garment_filter.js`.
3. Add it to `content_scripts` in `manifest.json`, before `widget-core.js`.
4. Add it to `SITE_FILES` / `SITE_GLOBALS` / `SITE_HOSTS` in `check.mjs` §11.
5. Add a fixture table alongside §12/§13/§13b, and host cases to §14 (including its `files` array — a filter missing from that array is never loaded by the integration test, so every case still passes).
6. Add it to `WIDGET_JS_FILES` **and** `LINT_FILES` in `release.sh`, and widen `GARMENT_FILTER_HOSTS` **and** `GARMENT_FILTER_FILES` in the `anywear*.js` launchers.

**Watch the duplicated trees in step 6 — six files, not three, and two `release.sh`:**

| What | Copies |
|---|---|
| `release.sh` | project root **and** `chrome_extension/release.sh` — identical but for how they resolve `ROOT`, both live entry points |
| `anywear*.js` | `shoppify/public/` **and** `backend/shopify/public/` — currently byte-identical |

`release.sh` ships launchers from `backend/shopify/public`, while `check.mjs` §11 reads `shoppify/public`. Update only one and you get the worst outcome available: the check passes against a copy that is not the one being shipped.

Steps 4–6 are what `check.mjs` §11 exists to force: skip any of them and the filter works in the extension while doing nothing on a web install of the same store.

---

## Telemetry

Every filter reports once per reason per page — `revolve_garment_filtered`, `ugg_garment_filtered`, `guess_garment_filtered`, `loropiana_garment_filtered` — so systematic over-blocking shows up as data rather than as a guess. UGG's `unknown → block` default is aggressive; without this, over-blocking is invisible. If one fires broadly, the retailer changed something.

On Guess the reasons are diagnostic rather than a policy readout: `not_product_page` is the ordinary case and should dominate, while **`pdp_verdict_missing` should never appear in a shipped build** — it means `widget-core` stopped passing the verdict and PDP scoping is silently off. `check.mjs` §13b pins that wiring, so an event of that kind in production means something shipped around the check.
