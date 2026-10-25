# Choosing the garment reference image

Everything that decides **which pixels we hand the model** as the garment, across
every entry point: drag, the hover Try-On button, and product-page auto-detect.

> **Filename note.** This started life as a document about drag-and-drop from
> flip-on-hover cards, and the name stuck. It now covers reference-image
> selection generally. The path is referenced from comments in `widget-core.js`,
> so renaming it means updating those too.

**Two halves, and they compose:**

| | Question | Sections |
|---|---|---|
| **Part 1** | Which single image is the *right* one? | Patterns A / B, `<picture>`, hover-stuck |
| **Part 2** | When is a *pair* better than one image? | Two-up composite, PDP rules, button gating |

Part 1 came first and is purely defensive — sites lie about which image is
showing. Part 2 builds on it: once you can reliably identify the front view, the
back view stops being a hazard and becomes extra information worth sending.

**Relevant functions:** `_resolveDragSource`, `_hoverSafeDragUrl`,
`_clearHoverAfterDrag`, `_compositePair`, `_heroSizeGroup`, `_isExtraGalleryView`
— all in `widget-core.js`.

---

# Part 1 — Picking the right single image

## The problem

Fashion product listing pages (PLPs) commonly show a different image when the user hovers over a product card — the back-of-garment view, an alternate angle, etc. When the user then drags that image into the widget, two things break:

1. **Wrong image URL captured** — the dragged element is the hover/back image (V3), not the front (V1).
2. **Hover state stuck** — after drop, Chrome's `:hover` freeze never lifts, so V3 stays visible on the product card.

---

## Background: Chrome's :hover freeze during drag

Chrome freezes `:hover` evaluation for the entire duration of a native drag gesture. This is intentional — hover effects would flicker as the user drags across the page. The freeze is supposed to lift on the first real `mousemove` event after `dragend`.

**The stuck case:** if the user drops into the widget iframe and does not move the mouse afterward, the host page never receives a `mousemove`. `:hover` stays frozen, and the back image (V3) remains visible on the product card indefinitely.

---

## Pattern A — CSS two-img stack (Revolve, ASOS, most PLP grids)

### How the site implements it

```html
<div class="product-card">      <!-- :hover target -->
  <img src="front.jpg" />       <!-- V1: front image, always in DOM -->
  <img src="back.jpg"  />       <!-- V3: back image, shown on top during hover -->
</div>
```

```css
.product-card img:last-child { opacity: 0; }
.product-card:hover img:last-child { opacity: 1; }
```

When hovered: V3 is on top and visually on screen. `dragstart` fires on V3 because it is the topmost hit-testable element.

### Fix

Redirect `e.target` to the **first `<img>` in the parent container** — fashion sites universally put the front image first in DOM order.

```js
const firstImg = Array.from(sourceEl.parentElement.querySelectorAll('img'))
                      .find(i => i.offsetWidth >= 80);
if (firstImg && firstImg !== sourceEl) {
  sourceEl = firstImg; // now points to V1
}
```

**The `offsetWidth >= 80` guard:** some sites put a badge or icon `<img>` before the product image in DOM order. A badge is typically 16–32 px wide. Skipping any candidate narrower than 80 px ensures we don't mistake a badge for the product image.

**Filter first, then take the first — order matters.** An earlier version read
`querySelector('img')` and then checked its width, which *cancelled the redirect*
whenever a badge came first in the DOM: `sourceEl` stayed on the back image and we
sent the wrong view. Filtering before selecting is what makes the guard skip the
badge instead of skipping the fix. The click path had the same bug in the opposite
direction — no width check at all — and would hand the badge over as the garment.
Both now share this shape.

### URL extraction after redirect

After redirecting to V1, we still call `_hoverSafeDragUrl(V1)` to read `srcset` / `data-*` attrs rather than `.src`. This handles the case where V1 is also a lazy-loaded image whose `.src` is a placeholder.

---

## Pattern B — JS src-swap (ZARA, Net-a-Porter, Farfetch)

### How the site implements it

```html
<img
  src="front.jpg"           <!-- mutated to back.jpg on hover -->
  srcset="front-400.jpg 400w, front-800.jpg 800w"
  data-hover="back.jpg"
/>
```

```js
img.addEventListener('mouseover', () => { img.src = img.dataset.hover; });
img.addEventListener('mouseout',  () => { img.src = originalSrc; });
```

`e.target` is the right element — there is only one `<img>`. But `img.src` has been mutated to the back URL by the time `dragstart` fires.

### Fix

Read `srcset` / `data-src` / `data-lazy` / `data-original` / `data-lazy-src` / `data-zoom-image` / `data-large-image` instead of `.src`. Hover-flip JS **never mutates these attributes** — only `.src` is touched.

```js
function _hoverSafeDragUrl(img) {
  // <picture><source srcset="…">  → checked first
  // img.srcset                    → checked second
  // data-src / data-lazy / …      → checked last
  // Returns null if none found; caller falls back to _extractImageUrlFromEl
}
```

---

## Pattern B + `<picture>` (Net-a-Porter, some Shopify themes)

```html
<picture>
  <source media="(min-width: 800px)" srcset="front-large.jpg" />
  <img src="front-small.jpg" />
</picture>
```

`_hoverSafeDragUrl` checks `img.closest('picture')` first and reads the `<source srcset>` before checking the `<img>` itself. This returns the largest/best URL for responsive images.

---

## Remaining gap — Pattern B, bare `.src` only

If a site does JS src-swap AND has **no `srcset` or `data-*` attrs**, `_hoverSafeDragUrl` returns `null` and `_extractImageUrlFromEl` falls back to `img.src` — which is the mutated back URL.

**Why we don't fix it here:** fixing it would require storing the pre-hover `.src` value before the site's `mouseover` handler fires. That snapshot is only available on the VTO button click path (via `_capturedImgUrl` inside `setupImageButtons`, which listens in capture phase). Wiring the same capture to the drag path would add significant complexity for an extremely rare case on modern fashion sites, all of which use `srcset` or `data-*` attrs.

---

## Hover-stuck behavior — known gap

**Status: partially mitigated. A click on the host page is the only reliable reset.**

After a drag-drop into the widget, the product card often stays stuck showing V3
(the back/hover image) even though the cursor is no longer over it. Only a click
somewhere on the host page reliably resets the `:hover` state.

### Why it happens

Chrome freezes `:hover` evaluation at the OS compositor level for the entire drag
gesture. The freeze is meant to lift on the next real mouse input event on the host
page. But when the user drops into the widget iframe and then holds still (watching
the try-on), no real mouse event reaches the host page → `:hover` never updates →
V3 stays visible.

### Why we cannot fully fix it from JS

`:hover` is part of Chrome's compositor-level input pipeline, not a DOM property.
It updates only when the OS delivers a real mouse event to the host page.
No amount of style manipulation, synthetic events, or DOM mutations from a content
script can force a full re-evaluation. This is by design.

Specifically:
- **Synthetic `mousemove`** — explicitly excluded from `:hover` updates per spec.
- **Setting `pointer-events: none`** — triggers a style recalculation, but
  Chrome's hover state is tracked upstream of CSS and is not cleared by this.
  The `_clearHoverAfterDrag` function is kept as a marginal helper (it may help
  in some edge cases where the freeze is shallow), but it does NOT reliably fix
  the stuck-hover problem.
- **`display: none` / reflow tricks** — remove the element from the rendering tree,
  clearing its pseudo-classes, but cause a visible one-frame flash and still do not
  update the OS-level hover position record for the page.

### What does fix it

A real OS click or mousemove on the host page. This always resets `:hover`
correctly. In practice: if the user moves their mouse out of the widget back over
the site, the flip resets immediately.

---

---

# Part 2 — Sending both views

## Two-up composite

**Relevant functions:** `_secondProductImage`, `_imageBytes`, `_compositePair`, `_pairCompositeFor` in `widget-core.js`; `DECART_FETCH_IMAGE` in `background.js`

Once we can reliably tell the front image from the back, the back stops being a
hazard and becomes free information: it is a second view of the *same garment*.
So when a card gives us a clean pair we stitch them into one reference image —
**front on the LEFT, back on the RIGHT**, both scaled to a common height (capped
at 1024 px) — and send that instead of the front alone.

Delivery is unchanged and entirely in-page. The stitched canvas is emitted with
`toDataURL('image/jpeg')` and passed through the existing `DECART_AUTO_START`
field. The SDK's `imageToBase64` checks for a `data:` URL **first** and reads the
base64 straight out of it, so the pixels never leave the browser — no upload, no
bucket, no cross-origin POST, and byte-identical behaviour in the extension and
in a one-line web install. Nothing in the bundle or the widget contract changes.

Note that `set_image` always carries base64 on the wire regardless; a URL is
merely one of the things `imageToBase64` knows how to turn into base64 (by
fetching it from inside the iframe — which is why retailer-CDN CORS is already a
requirement of the *existing* flow, not something compositing introduces).

**Identity vs payload.** `_compositeDataUrl` is deliberately kept apart from
`_referenceImageUrl`. Everything analytics- and identity-shaped — `reference_image`
on tracked events, the dHash prefetch, the attribution record, the restart queue —
keeps using the real retailer URL, which is short, stable and dedupable. Only the
bytes handed to the SDK come from the composite. It is consumed once on delivery
so a stitched pair can never be re-sent for a different garment.

### When we composite — deliberately strict

`_secondProductImage` returns the back image only when the card holds **exactly
two** images of at least 80 px. Three or more is almost always a colour-swatch
strip or an angle carousel, where the second image may be a **different
colourway** — compositing that would actively poison the reference. When in
doubt we send the front alone.

### The CORS constraint

We can `drawImage` a cross-origin retailer image onto a canvas, but we cannot get
the pixels back out: `toBlob()` / `getImageData()` throw `SecurityError` on a
tainted canvas. This is the same wall `DECART_HASH_IMAGE` hit.

| Context | How bytes are read | Works? |
|---|---|---|
| Extension | `DECART_FETCH_IMAGE` → background worker (`<all_urls>` host permissions bypass page CORS, returns a non-tainting `data:` URL) | ✅ always |
| Shopify / plain web | in-page `fetch` | ✅ when the CDN sends `Access-Control-Allow-Origin` (Shopify CDN, Cloudinary do) |

**Every failure degrades to the front image alone** — CORS refusal, decode error,
upload error, tainted canvas. There is no path where compositing makes a try-on
worse than not compositing.

### Timing

- **Drag path** — started at `dragstart`, awaited in `_tryInferDrop`. The gesture
  itself hides the latency, exactly as `_dragValidationPromise` already does.
- **Click path** — done on click, not on hover. Compositing on hover would upload
  a composite for every card the cursor crosses. Usually a few hundred ms, since
  both images are already in the HTTP cache.

Results are memoised per `front|back` pair, so re-dragging a card does not re-upload.

### Product pages — the same-size rule

The catalogue rule ("exactly two images in the card container") does not transfer
to a PDP: gallery shots are rarely siblings in one parent. On a product page the
discriminator is **rendered size**.

`_productImagePairImgs()` takes the hero — the same image `findProductImage()`
picks — and looks for another image rendered at the same box, within 2 px per
side. A gallery lays its views out identically, so a size match means "another
view of this garment". A size *mismatch* means the page has one big image and the
other thing is a thumbnail strip, a size guide, or a related-product tile — so we
send the hero alone.

Two details that matter:

- **Rendered size, not `visibleArea`.** `visibleArea` shrinks as an image scrolls
  out of view, so two identically-laid-out gallery shots score differently the
  moment the page moves. Rendered size is stable.
- **The sibling may be off-screen.** `_productImageCandidates(false)` drops the
  `visibleArea > 10000` clause for the sibling search. With it left in, a vertical
  gallery — where the next view sits below the fold — would never pair. The hero
  is still chosen from the visible set.

The 2 px tolerance absorbs fractional layout (flex/grid rounding, zoom, DPR); it
is not a fuzzy match, and a 10 px difference does not pair.

Verified on a live Gymshark PDP: hero at 640×800 paired with its same-size
sibling 1200 px further down the page, stitched to 1718×1024 / 135 KB.

### Clicking the Try-On button on a gallery view

The button can land on any of the big views, not just the hero. `_pdpClickPairImgs`
pairs whichever one was clicked with its neighbour in the hero's size group — the
**next** view if there is one, otherwise the **previous**. So clicking the big
product image pairs it with the shot after it, and clicking that shot pairs it back
with the big one: the same two images either way.

The pair is always emitted in **document order** (earlier view on the left), so the
reference image is byte-identical regardless of which half was clicked. If the
clicked view should instead always lead, swap the return in `_pdpClickPairImgs`.

Membership in the hero's size group is the gate, which is what stops a filmstrip
of same-size thumbnails from pairing with itself — those thumbs match each other
but not the hero, so they are never eligible.

The click handler tries the catalogue-card rule first and this second; they cover
different page shapes and never both apply.

Verified on a live Gymshark PDP: clicking the 640×800 hero and clicking its
same-size neighbour 1200 px below both yield the same pair, and clicking a
differently-sized image yields none.

### Where the Try-On button is offered on a PDP

A product page with four or five big views does not want a button on every one of
them: whichever you click, the pair we build is the same, so the extra buttons
offer a choice that does not exist. The button appears on the **first two** views
of the hero's size group and is suppressed on the rest
(`_PDP_BUTTON_MAX_GALLERY_VIEWS = 2`).

Everything *outside* the group is untouched — "you may also like" tiles, editorial
shots, related products. They are a different size, so they were never group
members, and they keep their button exactly as before.

**The catalogue hazard.** This rule is gated on `_isProductPageCached()`, and that
guard is not optional. On a catalogue grid every product tile is rendered at the
same size, so the hero's "size group" would be *the entire product grid* — and the
rule would hide the Try-On button on every product but the first two. The guard is
the only thing standing between this feature and that regression; it has a test.

**Fails open.** Not a PDP, no group, image not in the group, or a stale memo after
a gallery re-render (`indexOf` → `-1`) all mean "show the button". The worst
outcome is a button we meant to hide; never a missing one.

**Cost.** `_heroSizeGroup()` measures every `<img>` on the page, and this runs on
every `mouseover`, so it is memoised on the same 2 s window as
`_isProductPageCached()` and for the same reason. The group is stable across
scrolling *within the gallery*: as the hero changes to another view, the members are
all the same size, so the set does not move. It is **not** stable once the page is
scrolled past the gallery. The hero is then a recommendation tile or nothing, and a
guess made there is held for those 2 s. On loropiana.com that hid the product's
button (a mid-page reload is enough). See docs/pdp-first-image-recheck.md.

**Drag is not gated.** Dragging the fifth view still works and still composites.
This only controls where the button is *offered*.

### Three button paths, one resolver

There are **three** Try-On button click paths, and they had drifted apart:

| Path | Where | Runs when |
|---|---|---|
| Pre-open pinned | `_pinPreOpenButtons` | `_alwaysShowImageButtons` — **the default** |
| Always-show pinned | `_sendPinnedClick` in `setupImageButtons` | `BUTTON_VISIBILITY === 'always'` |
| Floating hover | `btn` click in `setupImageButtons` | `BUTTON_VISIBILITY === 'hover'` (legacy) |

Two of them read `img.currentSrc` directly — which on a flip-on-hover card is the
**back** image — and neither composited. Since `_alwaysShowImageButtons` defaults
to `true`, the pinned paths are what actually run, so anything added only to the
hover path is dead code. This was caught on a live Revolve PLP: the DOM was
perfect (500/500 tiles with distinct V1/V2 pairs) and the CDN sends `ACAO: *`,
yet no composite ever appeared, because the code sat on a path that never fires.

All three now go through `_clickGarmentTarget` (width-filtered first-in-parent +
hover-safe attrs) and `_clickGarmentComposite` (card rule, then PDP rule).
**Anything new belongs in those two helpers, not in a handler.**

One scoping trap worth remembering: `_capturedImgUrl` is declared partway down
`setupImageButtons`, *after* the `return` that ends the pinned branches. Reading
it from `_sendPinnedClick` throws `ReferenceError: Cannot access before
initialization` — the `let` is still in its temporal dead zone because execution
never reaches the declaration. Only the hover path may use it.

### Open question — the "Buy now" origin

`applyProductImage` in the bundle derives the Buy-now link from the delivered
image URL (`new URL(url).origin`). A `data:` URI has origin `"null"`, so a
composited try-on would produce a broken Buy-now target. This is unresolved:
the link is already imprecise today (it resolves to the image CDN origin, not
the product page), but `"null"` is a visible regression rather than an
imprecision. Either the bundle should take the page URL explicitly, or the
button should be suppressed when a composite is delivered.

---

---

# Reference

## Coverage table

| Site / pattern | `e.target` issue | URL issue | Status |
|---|---|---|---|
| Revolve, ASOS — CSS two-img stack | V3 (back img) | V3's `.src` | ✅ Pattern A fix |
| ZARA — JS src-swap + `srcset` | None | `.src` mutated | ✅ Pattern B fix |
| ZARA lazy-load — JS swap + `data-src` | None | `.src` mutated | ✅ Pattern B fix |
| Net-a-Porter — `<picture><source>` | None | `.src` mutated | ✅ `<picture>` fix |
| Generic — single img, no flip | None | None | ✅ Works as-is |
| Div/anchor drag (non-img) | N/A | N/A | ✅ `_extractImageUrlFromEl` Phase 2 |
| Pattern B, bare `.src` only | None | `.src` mutated | ❌ Known gap (rare) |
| Hover stuck after drop | N/A | N/A | ❌ Known gap — only a real click/mousemove fixes it |

### Part 2 — when a pair is built

| Page shape | Rule | Result |
|---|---|---|
| Catalogue card, 2 imgs in the tile, different URLs | card pair | ✅ composites (Gymshark: 70/70 cards) |
| Catalogue card, 2 imgs with the **same** URL | `frontUrl === backUrl` guard | ➖ single image (Allbirds: 0/34) |
| Catalogue card, 3+ imgs in the tile | colourway guard | ➖ single image |
| PDP, hero + same-size view | size group | ✅ composites |
| PDP, hero + smaller thumbnail / related tile | size mismatch | ➖ single image |
| PDP, click on view 1 or 2 | click pair | ✅ same pair either way |
| PDP, 3+ same-size views | button gating | 🚫 button only on the first two |
| PDP, related tiles (smaller) | not group members | ✅ button kept, no pair |
| Catalogue grid (same-size tiles) | `_isProductPageCached()` guard | ✅ every tile keeps its button |
| CDN sends no `ACAO` (web install) | canvas cannot export | ➖ single image |
| Any decode / stitch failure | catch | ➖ single image |

---

## Where the code lives

| Function | File | Purpose |
|---|---|---|
| `_resolveDragSource(e)` | `widget-core.js` | Single entry point: Pattern A redirect + URL extraction |
| `_hoverSafeDragUrl(img)` | `widget-core.js` | Reads hover-safe attrs from an `<img>` |
| `_clearHoverAfterDrag(el)` | `widget-core.js` | Clears stale `:hover` after dragend |
| `_onDragStart` | `widget-core.js` | Calls `_resolveDragSource`, starts async validation |
| `_onDragEnd` | `widget-core.js` | Calls `_tryInferDrop` then `_clearHoverAfterDrag` |
| `_secondProductImage(img)` | `widget-core.js` | Catalogue card: the back img, only when the tile holds exactly two |
| `_imageBytes(url)` | `widget-core.js` | Taint-free bytes — worker in the extension, `fetch` on web |
| `_compositePair(a, b)` | `widget-core.js` | Canvas stitch → `data:` URI; memoised per pair |
| `_pairCompositeFor(img, url)` | `widget-core.js` | Catalogue-card entry point |
| `_productImageCandidates(vis)` | `widget-core.js` | Scored image list; `vis:false` includes below-fold |
| `_heroSizeGroup()` | `widget-core.js` | Hero + every same-size view, in document order |
| `_productImagePairImgs()` | `widget-core.js` | Auto-grab pair: hero + next view |
| `_pdpClickPairImgs(img)` | `widget-core.js` | Click pair: clicked view + neighbour |
| `_autoPairComposite(url)` / `_pdpClickPairComposite(img)` | `widget-core.js` | PDP entry points |
| `_isExtraGalleryView(img)` | `widget-core.js` | Button gating past the first two views |
| `DECART_FETCH_IMAGE` | `background.js` | Worker fetch that bypasses page CORS |

The VTO **button click** path uses `_hoverSafeDragUrl` via a local alias `_hoverSafeImgUrl` inside `setupImageButtons`. It also has access to `_capturedImgUrl` (capture-phase mouseover snapshot) which covers the bare-src-swap gap — the drag path does not.

---

## State of play

**Verified:** 16/16 on the composite itself (geometry, left/right order, caching,
every fallback), 10/10 on the PDP same-size rule, 14/14 on click pairing, 11/11 on
button gating. End-to-end against live pages: a Gymshark PLP card (1718×1024
stitch) and a Gymshark PDP (hero paired with a same-size view 1200 px below).

**Not yet verified:**

- The drag / click / auto wiring has never been exercised in a real browser with
  the extension loaded — only the functions behind it have.
- The extension's `DECART_FETCH_IMAGE` worker path is untested end-to-end; the
  web `fetch` path is the one proven live.
- **Whether a 2-up reference actually improves the try-on.** Nobody has run a real
  session and compared. The whole feature rests on this, and it is still open.
