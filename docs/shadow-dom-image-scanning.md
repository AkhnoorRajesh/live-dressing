# Shadow DOM image scanning

**Relevant commits:** uncommitted at time of writing. Follows the guess.com filter (`guess.js`, frontend#7), which is what surfaced this.
**Relevant files:** `_allImgs` / `_shadowRoots` / `_collectShadowRoots` / `_closestComposed` / `_composedMatch` / `_ensureShadowBtnStyles` / `_isTryOnableImage` / `_pinBtn` / `_pinMobileBtn` / `_imageProfile` in `widget-core.js` · `scripts/check.mjs` §17

---

## The bug

An `<img>` inside an open shadow root is invisible to `document.querySelectorAll('img')`. Every image scanner in `widget-core.js` used exactly that call — 6 full-page call sites — so on a site that builds its gallery as a Web Component we placed **no Try-On buttons at all**.

Nothing threw. Nothing logged. The widget injected, the pill appeared, PDP detection returned `true`, and then no button — because there was no image to attach one to.

Found on guess.com, where `<product-gallery>` keeps five 632×948 product images in its shadow root while the light DOM carries only a hidden 0×0 preload stub (`slot="preloaded"`), which fails the 120 px minimum anyway. Measured there:

| | light DOM | + open shadow roots |
|---|---|---|
| `<img>` elements | 13 | **88** |
| product images ≥120×120 | 0 | 35 |

This was never Guess-specific. Any retailer on Web Components was silently getting nothing.

## Why it was invisible for so long

The failure has no signature. A site we cannot scan looks exactly like a site with no product images: the scanners return an empty candidate list and every downstream stage correctly does nothing with it. There is no error state for "the DOM has content we are structurally unable to see."

Guess made it visible only because `guess.js` also suppresses the floating pill (`_filterOwnsEntry`), which removed the fallback entry point and turned "no buttons on the grid" into "no way in at all".

---

## The rule: additive or nothing

This traversal runs on **every site**, so the property that matters is not "does Guess work" but "does every site that worked before behave identically". Each helper reduces to its pre-change behaviour on a page with no shadow roots:

| Helper | On a shadow-free page |
|---|---|
| `_allImgs()` | returns the same elements in the same order as `document.querySelectorAll('img')` |
| `_closestComposed(el, sel)` | stops exactly where `closest()` stops — `getRootNode()` is the document, there is no `.host`, the loop ends |
| `_composedMatch(e, sel)` | never runs; it is only reached after the caller's own lookup returned nothing |
| `_ensureShadowBtnStyles(node)` | no-op — `getRootNode()` has no `.host` |

**Light DOM is collected first, and that ordering is load-bearing**, not cosmetic. Pin order feeds wrapper dedupe and first-img-in-parent, so on a shadow-free page the list has to be identical in *order* as well as in content. `check.mjs` §17 pins this.

### Verified on live sites

| Site | Shadow roots | Before | After | Result |
|---|---|---|---|---|
| revolve.com PLP | 0 | 77 imgs | 77 imgs | **identical list and order**, 0 landmark divergence |
| guess.com PDP | 302 | 13 imgs | 88 imgs | old 13 are an **unchanged prefix**, no duplicates |

---

## Three things break at the boundary, not one

Enumeration is the obvious one. The other two are why "just swap the selector" would have produced a half-working feature.

### 1. Enumeration — `document.querySelectorAll('img')`

Six full-page call sites now go through `_allImgs()`. The remaining `querySelectorAll('img')` calls in the file are **tree-scoped** (`parentElement`, `host`, `up`) and need no change: an element inside a shadow root queries its own tree correctly.

`check.mjs` §17 asserts exactly **one** `document.querySelectorAll('img')` remains in code — the one inside `_allImgs` itself. A seventh scanner added later without the helper is the original bug for one code path.

### 2. Events retarget to the host

`e.target` for an event originating inside an open shadow root is the **host**, not the element hit. `document.elementsFromPoint()` likewise returns the host, not its contents. So:

- the pinned-click capture listener could not find `.vton-btn`
- the hover handler could not find the `img`

`composedPath()` is the one view spanning both trees, and `_composedMatch()` uses it — **as a fallback only**. This is deliberate: `elementsFromPoint` exists to fix a real carousel bug (hidden slides' buttons occupy the same coordinates as the visible slide's; `elementsFromPoint` skips `display:none` and returns the visually front button). `composedPath()` does not address that, so promoting it to primary would trade one bug for another on every light-DOM site.

The mobile pre-open button needs none of this — it carries its own `click` listener, which fires normally inside a shadow root.

### 3. Styles do not cross the boundary

Shadow DOM encapsulates CSS, so a button appended inside a root receives none of the document-level sheet and renders as **unstyled text over the product photo**. `_ensureShadowBtnStyles()` clones the canonical `#__decart-imgbtn-style` into the root, once per root (WeakSet-keyed, collected with the page).

One rule has to be rewritten on the way in:

```css
/* light DOM */            html.decart-collapsed .vton-btn { display: none !important; }
/* shadow copy */  :host-context(html.decart-collapsed) .vton-btn { display: none !important; }
```

`html.decart-collapsed` cannot match inside a shadow tree — there is no `<html>` in that tree scope — so the pill's × would silently stop hiding these buttons. `:host-context()` reaches back out to the host's ancestors.

**Known gap:** `:host-context()` is Chromium-only. On a browser without it, shadow-DOM buttons do not hide on collapse. Cosmetic, and on a path that only exists on Web Component sites.

---

## Cost, and why the root set is cached

Measured on a guess.com PDP — and this is why the walk is not simply run inline:

| | cost |
|---|---|
| `document.querySelectorAll('img')` | 0.035 ms |
| recursive shadow-root walk (302 roots, 1000 elements) | **2.19 ms** — 60× |

The pin sweep runs on **every DOM mutation** (rAF-coalesced). Walking every time would put ~2 ms of tree traversal into every frame of a scroll on exactly the pages that lazy-load hardest.

So the root set is cached on a **2 s window**, the same as `_imageProfile` and `_isProductPageCached`, for the same reason.

The cost of that cache is that a newly attached root is discovered within 2 s rather than instantly. That is acceptable because **only discovery is delayed**: once a root is known we attach a `MutationObserver` to it, so anything happening inside it is seen immediately. This matters — a document-level observer never fires for a mutation inside a shadow root, so without the per-root observers a lazily rendered gallery would be scanned once and then never again.

Both pin paths register their sweep as `_shadowMutationCb`, so a shadow mutation re-runs the same work the document observer would have. §17 asserts both do.

On revolve.com (0 roots) the walk costs 0.16 ms and is cached, so the added cost on a shadow-free site is negligible.

### Depth cap

`_SHADOW_MAX_DEPTH = 6`. Observed nesting on guess.com is **3**, so this is headroom, not a limit anyone is near. It exists so a pathological or cyclic component tree cannot turn one scan into an unbounded walk.

---

## Closed roots stay unsupported

`Element.shadowRoot` is `null` for a closed root **by design** — there is nothing to traverse and no trick that changes that. A site using closed roots remains unsupported, and that is a property of the platform, not a gap to close later.

We also never call `attachShadow` ourselves. §17 asserts this: we read other people's open roots; we must never create or reopen one on a retailer's page.

---

## Consequence worth knowing on PDPs

On a Guess PDP, 35 product images now survive the geometry rules — the hero plus every gallery view and colourway. That is not 35 buttons: `_isExtraGalleryView()` suppresses everything past the first two views of the hero's size group, because each would build the same reference pair. That guard was written for light-DOM PDP galleries and applies here unchanged.

---

## If a site still shows no buttons

In order of likelihood:

1. **Closed shadow roots** — `document.querySelectorAll('*')` then check `.shadowRoot` on the gallery host. `null` on an element that clearly has rendered children means closed. Unsupported.
2. **Images are CSS `background-image`, not `<img>`** — a different gap entirely; nothing in this file scans backgrounds.
3. **Root attached later than the 2 s discovery window and nothing mutated since** — should self-correct on the next sweep; if it does not, the per-root observer never attached.
4. **Buttons present but invisible** — the stylesheet clone did not land. Check for a `<style>` inside the root, and that `#__decart-imgbtn-style` exists in the light DOM at the time `_ensureShadowBtnStyles` ran (it returns early if the canonical sheet is not injected yet).
