# The page's first image, re-checked after a scroll or an image load

**Relevant commits:** PR #40 (the scroll trigger; squash-merged to `main`, branch commit `f62268a`) · PR #41 (the image-load trigger for colour switches; branch commit `0502eb5`).
**Relevant files:** `widget-core.js` — `_recheckFirstImage`, `_topOfPageHero`, `_hasPinnedButton`, the `fromPageTop` argument of `_productImageCandidates`, the scroll and image-load listeners in `_bindSweepTriggers` · `scripts/check.mjs` §18b

---

## Where to change it

👉 `_FIRST_IMAGE_RECHECKS_MAX` (3) in `widget-core.js`: how many re-checks one first image may cost before the widget accepts its refusal as final.

The "at least half on screen" threshold is the `area / 2` comparison in `_recheckFirstImage`. The load delay is the `120` in the image-load listener in `_bindSweepTriggers`.

## What it does

On a product page the widget re-checks at two moments: when a scroll ends, and 120 ms after an image loads. If the page's **first product image** is at least half on screen **without a Try-On button**, it forgets its gallery guess and places buttons again, once. The first image is the one that wins at the top of the page. It does this at most three times per first image, and a colour switch brings a new first image, so the count starts again. On every other page, and on any product page whose first image already has its button, a scroll end or an image load does nothing.

## What we noticed

On loropiana.com product pages the Try-On button sometimes arrived a second or two late, and sometimes never came. The page had visibly finished loading both times. It was worst right after **switching colour**: the new colour's photos were on screen, and the button took seconds to come back, or never did.

## What was actually happening

Three facts combine.

1. **The gallery guess reads what is on screen.** `_heroSizeGroup()` starts from the image with the most *visible* area right now. On a page scrolled past its gallery, that is a recommendation tile, or nothing at all.
2. **The guess is held for 2 s.** Three memos keep it: `_galleryGroupCached`, `_galleryAllowedCached` and `_primaryProductImages`. An *empty* primary set is memoised like any other.
3. **Scrolling is not a sweep trigger.** Buttons are re-placed on a DOM mutation, an image `load`, a resize or a tab switch (`_bindSweepTriggers`). Once the page stops mutating, the last answer is final.

Measured on the live `classic-polo-FAO5738_W000` page at 1024×768:

| Scenario | What happened |
|---|---|
| Reload with Chrome restoring the scroll to 1200 px | First sweep at 1998 ms: no gallery, empty primary set, first image refused (`pdp_not_first_view`). Scrolled to the top at 3526 ms. The button appeared at 4091 ms **only** because an unrelated mutation landed at 4079 ms, just after the memo expired. The next mutation after that was at 12668 ms. |
| Swept at 1400 px, then scrolled to the top | The "hero" was a 110×164 recently-viewed tile. 5.4 s with the gallery on screen and no button, until a third-party mutation happened to fire. |
| Same reload, with this change | Scroll ended at 2363 ms, re-check at 2364 ms, button on the first gallery image at 2369 ms. |

Reloading mid-page, which restores the scroll, is enough to get there. So is scrolling before `document_idle`.

## The colour switch — the same freeze, no scroll involved

A colour swatch on a Loro Piana PDP (`a.color-attribute`, Salesforce Commerce's `Product-Variation` AJAX) fetches the new colour and **replaces the whole gallery**. The new `<img>`s arrive as lazysizes placeholders: class `lazyload`, a `data-src`, **no `src`**. The sweep that runs on the swap cannot count them as candidates (a candidate needs a `src`). So the guess falls on a recently-viewed tile, and the 2 s memos hold it while the new photos load.

The memos' own "a member was detached, rebuild" check cannot catch this. The guess was rebuilt *after* the swap, from a tile that is wrong but still connected.

Measured live on `classic-polo-FAO5738_A001`, from the click:

| | Before | With the load re-check |
|---|---|---|
| Gallery replaced (old button gone) | +699 ms | +610–700 ms |
| Sweep on the swap | placeholders only, guess = a 110×164 tile, memoised | same |
| New first photo loaded | +1767 ms, swept, **still refused** from the memo | re-check 120 ms after the load |
| Button on the new first photo | **+2824 ms**, only because an unrelated mutation landed after the memo expired; otherwise never | **+782 to +987 ms** (172–287 ms after the swap), one re-check per switch |

Tested across all three colours (Natural Melange A001, Blue Navy W000, Black 8000), in both directions.

**Why 120 ms after the load, and not on the event itself.** The widget's capture listener fires *before* the site's own load handler. lazysizes only swaps the image from `opacity:0` (`.lazy__img`) to visible (`.lazyloaded`) in the frame after that. Checked on the event, the new photo still reads as hidden, and the re-check would rebuild the same wrong guess. It is a **throttle** (the first load of a burst, plus 120 ms), not a debounce, so a lazy-loading rail cannot keep pushing it back.

## Who it hurts

The wrong guess is the same everywhere. What it costs depends on which rule reads it:

| Rule reading the guess | Effect of a wrong guess | Where |
|---|---|---|
| A filter that offers only the product's own first image (`isPrimaryProductImage`) | **Button missing** | loropiana.js (reproduced live) |
| The `<aside>` exemption (`_isThisProductsGalleryImage`) | **Button missing** | Uniqlo-style galleries kept in an `<aside>` |
| The two-views cap (`_isExtraGalleryView`) | Gallery views 3+ keep a button | every other product page; fails open by design (docs/drag-flip-on-hover.md) |

Only the first two rows are bugs. Neither is about one retailer, so the fix is generic. It switches on from the symptom (first image on screen, no button), not from a hostname. `widget-core.js` names no retailer.

**Uniqlo, measured live** (`E489227-000`, 550 images): with the first sweep run 3153 px down, the gallery had **0** buttons, which confirms the `<aside>` case exists. On that page it healed by itself within 400 ms of scrolling up. There the wrong guess was "no group", which `_galleryGroupCached` does not memoise, and the page keeps mutating. The re-check correctly stayed out of it.

## Why it is built this way

Each alternative was weighed and rejected:

- **A sweep on every scroll.** That is a document-wide `<img>` scan per scroll gesture on every site, which §16/§17 and docs/shadow-dom-image-scanning.md exist to prevent. It also makes the fail-open row above systematic: on any product page scrolled past its gallery, views 3+ would get a button every time instead of occasionally.
- **Make the gallery guess itself top-of-page.** The guess's hero is the image `findProductImage()` picks. The auto-grab pair is built from it, and add-to-cart attribution records it (docs/drag-flip-on-hover.md, docs/per-website-garment-filters.md). Changing it for buttons alone splits those apart. It also leaves the Revolve carousel ranking (§19) ranking slides that are all off screen. So here the top-of-page image only decides **whether** to re-check. Every verdict still comes from the ordinary predicate.
- **Re-check when the 2 s memo expires.** That does not help a shopper who scrolls up after the expiry, which is the common case. On a colour switch it would still mean 2 s with no button after every click.
- **Forget the memos on every image load.** Every lazy-loaded rail image on every product page would then cost a full re-measure of the page, which is exactly the work the 2 s memos exist to save (6e2bf74). Routed through `_recheckFirstImage`, a load costs nothing on a page whose first image already has its button.
- **Loro Piana only.** The failure is generic (see the table), and widget-core cannot name a retailer.

## Cost

Measured on the Uniqlo PDP above (550 images), with a scroll end every ~2 s:

| | Cost |
|---|---|
| First scroll end on a product page (one top-of-page measurement) | 6.7 ms |
| Every later scroll end once the first image has its button | 0.2–0.3 ms |
| An image load (at most one check per 120 ms burst) | the same settled check: ~0.1–0.3 ms once the first image has its button |
| A re-check | one coalesced sweep, at most 3 per first image |
| Every scroll end or load after a first image used its 3 re-checks (a rightly refused product) | same as settled: no measurement |

The settled and gave-up checks run before anything that measures or parses. Before that ordering, every expiry of the 2 s memo cost 8–18 ms on that page. `check.mjs` pins the order.

## What fails silently, and how you would know

- **The scroll listener is lost.** Behaviour quietly returns to "button late or missing after a mid-page reload". `check.mjs` §18b fails.
- **The load listener is lost, or becomes a debounce.** The colour-switch button goes back to 2.8 s or never, or waits for every rail image to finish loading. `check.mjs` §18b fails.
- **No log in production.** Dev builds log `🔁 First image back on screen without a button — re-checking the gallery` once per re-check. No analytics event was added.
- **Hidden tabs fire no scroll events** (measured: a hidden tab got no `scrollend` after `scrollTo`). There is nothing to fix there: a page loaded in a background tab starts at the top.

## Not handled / not verified

- **A wrong first guess with no later scroll and no later image load.** Nothing here fires. Not observed.
- **A colour switch that swaps the photo by changing `src` on the SAME `<img>`.** The old button stays on that element, so there is nothing to fix. Loro Piana replaces the elements.
- **Colour switch timings were measured in a hidden browser pane**, with the swatch clicked from page JavaScript (`.click()` runs the site's own handler). Not yet confirmed in a visible Chrome with the unpacked extension.
- **A sticky or fixed gallery.** `fromPageTop` shifts its rect by `scrollY`, so it can drop out of the first screenful. The re-check then does nothing, which is the old behaviour.
- **"Rail above gallery" pages.** The top-of-page image is the rail, the same as on every ordinary load (docs/per-website-garment-filters.md, the containment table).
- **Real `scrollend` in a visible tab.** Live verification ran in a hidden browser pane, which fires no scroll events, so `scrollend` was dispatched by hand right after a real `scrollTo`. The code path from the event on was the real one.

## Testing

| What | How |
|---|---|
| Structure and behaviour | `npm run check` §18b. It runs the real `_productImageCandidates` (live vs top-of-page on the Loro Piana shape) and the real `_recheckFirstImage`: on-screen, already pinned, a quarter visible, off a PDP, the cap, and the settled short-cut. |
| Live, scroll | Open a listed Loro Piana PDP, scroll ~1200 px, reload, scroll to the top. The button should appear as the scroll ends. Before this change: 2 s plus a lucky mutation, or never. |
| Live, colour switch | On `classic-polo-FAO5738_A001`, click each colour swatch in turn. The button should be back on the new first photo within ~0.3 s of the photos changing. Before: 2.8 s, or never. |
