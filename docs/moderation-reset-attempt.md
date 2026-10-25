# Moderation reset attempt: content_flag to KV-cache reset to re-arm

**Files:** `moderation-reset-attempt.js` (the feature), `config.js` (`MODERATION_RESET_ATTEMPT`),
`widget.html` (load order), `widget-init.js` (session-end hook), `moderation-overlay.js`
(fallback overlay), `scripts/check.mjs` (check 7)
**Server side:** api commit `f51525443` (PR #3027), deployed and verified Jul 2026

---

## Superseded: the pod does this itself now (Sep 2026)

The in-pod behaviour this module was built to measure **shipped**, so the client
ladder is off by default. Config: `NSFW_THRESHOLD: 0.8` +
`SERVER_SIDE_ENFORCEMENT: true`.

| | |
|---|---|
| Switch | `?nsfw_threshold=0.8` on the signaling URL. **Sending the param IS the switch** — there is no separate enable flag. Sent on every session. |

**It is on for everyone, and nobody agrees to it.** There is no toggle, no prompt
and no consent gate; a shopper cannot decline it and a merchant cannot disable it
(the widget's `config.js` lives inside our own same-origin iframe, out of the host
page's reach). The api's docs call `?nsfw_threshold=` a per-session "opt-in" — that
names which side of the socket enables the lane, not anyone consenting to it. The
word survives in the event name `moderation_nsfw_optin_sent`, which is a live data
contract and stays as-is.
| api PRs | [#3703](https://github.com/DecartAI/api/pull/3703) (API-1768, the lane) and [#3989](https://github.com/DecartAI/api/pull/3989) (API-1833, `?nsfw_threshold=` selects kv-reset on pods that pin no mode). Deployed usw2 + IL in [#3995](https://github.com/DecartAI/api/pull/3995). |
| Bouncer | `_parse_nsfw_threshold` in `bouncer/src/realtime/stream.py` validates and forwards it. |
| Pod behaviour | kv-reset mode: wipes its own KV cache, burns a blur into the output, re-arms its detector, stream continues. |

**Validation fails OPEN.** The value must be finite and in `[0, 1]`; anything else
the bouncer drops with a warning and the session runs with **no moderation lane at
all**. A typo here is not a fallback to the old behaviour, it is no moderation.

### Why the client must not also reset

Our reset is a reference-image change, which starts a new condition epoch. Landing
one inside the pod's post-reset grace window (`NSFW_RESET_GRACE_S`, 2.5s) is exactly
the case the pod reads as *the new conditions are themselves flagrant* — and cuts the
session for. Running both ladders is worse than running either.

### The wire protocol gained a `phase`

`content_flag` now carries `phase`, and `mode` is meaningful:

```json
{"type":"content_flag","mode":"reset","phase":"flagged","direction":"output",
 "score":0.95,"streak":5,"frame_time_from_start_s":42.7}
{"type":"content_flag","mode":"reset","phase":"cleared","direction":"output"}
```

- `phase:"cleared"` — the pod's reset window closed (blur dropped, detector re-armed).
  **Not a flag.** `onContentFlag` returns early on it; counting it would inflate
  `flag_n` and, on the client ladder, spend a retry on an all-clear.
- `mode:"ghost"` on a session that sent the param means enforcement **did not take**
  (pod on an older image, or a rejected threshold). Nobody is acting on the flag and
  the stream keeps playing. Logged as `moderation_server_side_inactive` — that event
  firing at all is the alarm.

### The pod can still cut

Enforcement does not guarantee the session survives. The pod still cuts on an early
flag, an exhausted reset budget (`NSFW_MAX_RESETS`), or a failed reset. That arrives
as a terminal violation and socket close, which the widget's normal session-end path
handles. The client does not pre-empt it.

### Still open

`NSFW_NOTIFY` is slated for removal in **API-1832**, "once Anywear relies on the
server-side blur instead of this message". When that lands these events stop
arriving and the flag telemetry below goes quiet — the blur will still work, but the
measurement does not. Everything from `MAX_RESETS_PER_SESSION` down in `config.js`
applies to `SERVER_SIDE_ENFORCEMENT: false` only, kept so the ladder can be switched
back on without re-deriving the tuning.

---

## What it does

The pod's moderation detector runs in ghost mode on all VTON rt pods (threshold 0.8,
5-consecutive-frame latch, output frames only). On the vton-3.5 pools it also has
`NSFW_NOTIFY=true` and `NSFW_TOGGLE_ALLOWED=true`, so a latch reaches the client:

```json
{"type":"content_flag","mode":"ghost","direction":"output",
 "score":0.95,"streak":5,"frame_time_from_start_s":42.7}
```

Instead of ending the session, the extension tries to repair the stream:

1. wipe the model's KV cache by re-sending the garment with a pixel nudge
2. hold a blur until the reset lands, then re-arm the detector
3. if a flag proves unrecoverable, cut the session

This is a client-side preview of the intended in-pod behaviour, where the
streaming loop calls `_reset_stream_kv_cache(kv_cache, "nsfw_detected")` at the
next chunk boundary. Its purpose is to measure whether that is worth shipping.

## Why patch window.WebSocket

Two dead ends first:

| Seam | Why it fails |
|---|---|
| An SDK event | `SignalingChannel.handleMessage()` switches on `msg.type` with no `default` branch, so `content_flag` is parsed and dropped. Nothing to subscribe to. |
| The SDK client | `rtClient` is a module-local `var` inside `widget.bundle.js`, never on `window`. No object to call `setImage()` on. |

So `moderation-reset-attempt.js` wraps `window.WebSocket`. The patch is additive: `ws.send`
is wrapped to capture the widget's outgoing `set_image`, and an
`addEventListener('message')` reads `content_flag` and the acks. The SDK assigns
`ws.onmessage`, and a property handler plus listeners both fire, so the SDK is
unaffected. LiveKit's socket is wrapped too but speaks binary, so the
`typeof data === 'string'` guard skips it.

**It must load before `widget.bundle.js`.** The SDK builds its socket at session
start and resolves `window.WebSocket` at call time, so a later load would often
still work, but loading first is the only unconditional guarantee. Get it wrong
and it fails silently: no error, no hook, no reset. `npm run check` asserts it.

## Why re-sending the garment resets the cache

There is no reset command in the API. The pipeline resets when it *notices a
change*, once per chunk: prompt (string compare), reference image (exact tensor
compare), or resolution. The reset wipes only the model's memory of its own past
output; prompt embeddings and garment conditioning survive. vton-3.5 has no
self-anchor, so that cache is its only memory, which is why wiping it can break a
self-reinforcing bad stream.

So the trigger is a **reference nudge**: the same garment with the low bits of the
blue channel altered in an 8x8 corner block, PNG encoded (lossless; JPEG would eat
the change), alternating between two variants so consecutive resets always differ.
Invisible, and a guaranteed tensor difference. **A byte-identical replay is a
no-op**, since the compare is exact equality.

### The prompt must never be the trigger

The widget sends `TRY_ON_PROMPT = ""` and lets the bouncer's enhancer write the
real prompt from the garment. **The client never sees it.** Any prompt we invented
would replace it and degrade the try-on. (A bare `prompt` message is worse: the
bouncer turns it into a `set_image` with a gray placeholder and wipes the garment.)

`RESET_WITH_ENHANCEMENT: true` therefore replays the widget's own captured
`set_image` verbatim, same empty prompt, same missing enhance flag, only the pixels
nudged. That reproduces a real garment pick, and because the enhancer is
deterministic it returns the identical prompt. Note this means the prompt is
**recomputed to the same value**, not preserved, so it depends on that determinism.
Costs one enhancer call, 1 to 2 s.

`RESET_WITH_ENHANCEMENT: false` is the instant variant: no prompt field plus
`enhance_prompt: false`, so the pod's `if prompt:` check leaves the live prompt
alone. Equally valid, but relies on the pod already holding a good one.

Post-reset the first chunk is a **re-roll**: usually it re-locks the garment,
occasionally it slips to the person's real shirt. Whatever those first chunks
produce self-reinforces, which is why the reset attempt has to be measured, not assumed.

## When NOT to reset

**A reference change already wipes the cache.** So a flag within `FRESH_CACHE_MS`
(2000ms) of new output starting means the model produced moderation from an essentially
empty cache. There is nothing accumulated to clear, and resetting would re-run
identical inputs against another fresh cache. Those flags skip the reset and cut
the session, logged as `fresh_cache_flag`.

Early moderation is an input problem; late moderation is a memory problem, and only the second
is what a reset addresses. Same reasoning as `OUTPUT_FLAGS_ONLY` (a reset cannot
fix an input-side flag), applied on the time axis.

Measured from output going live: the `#shimmer` transition for the user's garment
picks, and ack + `RESET_APPLY_MS` for our own resets. Consequence: resets are only
ever spent on drift, so a hopeless stream still stops after one reset even with
`MAX_RESETS_PER_SESSION: Infinity`.

## Re-arming

The detector latches and stops scoring, so without a re-arm one reset is all we
could ever observe. PR #3027 added the mid-session toggle, now live:

```
out  {"type":"set_detector_scoring","enabled":true}
in   {"type":"set_detector_scoring_ack","enabled":true,"applied":true}
```

`content_flag` also fires on every latch now, which is what makes the loop and the
measurement real. A missing ack means the pod is not honouring the toggle (a pool
without `NSFW_TOGGLE_ALLOWED`, or an old image).

We re-arm only once the reset has landed. **The pod applies a changed reference at
its next chunk boundary, so the ack alone is not enough**: between ack and effect
the stream still shows the flagged frames. Hence `RESET_APPLY_MS` (400ms) before
releasing the blur, then `REARM_GRACE_MS` (600ms) before re-arming so the detector
cannot latch on the very first chunk. The settle window is closed at the re-arm,
because past that point every flag is genuinely about post-reset output.

`enabled:false` is never sent: the detector is already latched at the only moment
we would send it.

## What the user sees

**During a reset:** the stream blurs, a large spinner sits in the middle with
"We couldn't process that / Restarting the session" under it. Duration is
`ack + RESET_APPLY_MS + fade`, so roughly 1.5 to 2.5 s, dominated by the enhancer.

**On an unrecoverable flag:** the session is genuinely cut (peer connections
closed, reconnects blocked), not merely covered, and the session-ended card shows

- `This item is not supported` for a fresh-cache cut, where the item is at fault
- `Something went wrong.` for a stream that drifted and survived the resets

The purchase CTA and the "Save your session" recording link are hidden on this
path (never upsell on a failure, never offer a download of a stream we just judged
unacceptable), and **the restart CTA comes back without the garment that failed**,
so the user cannot loop straight into the same failure. On the unsupported-item
card that CTA is relabelled "Restart", since the default "Start again" reads as
"try the same thing again" when the item is the problem. No wording anywhere names
a moderation reason.

## Config and tuning

Defaults live in `config.js` under `MODERATION_RESET_ATTEMPT` (plain JS, not bundled: edit and
reload the extension). The same keys are tunable at runtime, which matters because
a reload costs a session you would have to reproduce:

```js
window.__decartModerationResetAttempt.configure({ MAX_RESETS_PER_SESSION: 5 })
window.__decartModerationResetAttempt.settings()     // current values + live counters
```

Numeric keys are validated and every call is logged as a `configured` timeline
entry, so a tuned run is not mistaken for a default one.

## Debug API

Run these in the **widget iframe** console, not the top frame:

```js
__decartModerationResetAttempt.report()        // counters + full timeline
__decartModerationResetAttempt.trigger()       // force a reset (outbound path)
__decartModerationResetAttempt.injectFlag()    // synthetic flag THROUGH the socket listener
__decartModerationResetAttempt.simulateFlag()  // call the handler directly (skips the listener)
__decartModerationResetAttempt.showNotice(ms)  // preview the notice
__decartModerationResetAttempt.probeNotice()   // is it rendered / covered? returns covered_by
```

`simulateFlag()` right after applying a garment now cuts the session (fresh cache),
which is correct. Use `trigger()` to exercise the reset path.

## Measurement

Events are `moderation_*` via `window.__decartTrack`, with a per-session
summary carrying `flags`, `resets`, `recovered` and `rearm_applied`.

**Filter on `rearm_applied === true` before computing any reset-attempt success rate.** Without
a successful re-arm the detector is blind after the first flag, so `recovered`
would be an artifact rather than evidence. Count `fresh_cache_flag` separately from
failed resets, since those were never recoverable by a reset.

Note these events go to the extension's analytics path
(`anywear.decart.ai/api/log`), not the Datadog pod logs the moderation dashboard reads.

## Invariants. Breaking any of these fails silently.

1. **Load before `widget.bundle.js`.** See above. `check.mjs` asserts it.
2. **Never send a prompt string.** The enhanced prompt is the quality lever and the client cannot see it.
3. **A byte-identical replay resets nothing.** The compare is exact equality, hence the nudge, PNG encoded.
4. **Cut sessions via `window.__decartForceSessionEnd`.** Its teardown is order-dependent, and an overlay without it leaves the stream and the billing running. `check.mjs` asserts the export exists.
5. **Override the overlay copy on any non-quota ending**, or it reads as a quota ending and upsells on top of a failure.
6. **`#shimmer` is not a completion signal for our resets.** The bundle raises it from its own `isApplyingProduct` flag, only true while the *bundle* calls `setImage()`. We send raw on the socket, so it never fires for us; waiting on it silently becomes a long stall. The persistent shimmer watcher is still valid for the user's own garment picks.
7. **Keep the notice centred.** The top strip is occupied by `#header` (z-index 10000), `#session-countdown` (31) and the host page's own title bar, which the iframe cannot measure because the parent is cross-origin. Anything anchored there needs all three handled.

## Verification status

- `npm run check` passes, including the two new guards in check 7.
- `configure()` is unit-verified against a node DOM stub.
- Confirmed live on a vton-3.5 session: the reset recovers the stream, the
  `set_detector_scoring` re-arm is honoured, an unrecoverable flag cuts the
  session, and "Start again" returns without the garment that failed.
- eslint has not been run (no `node_modules` in this clone).

## Open items

1. **Camera stays on after a cut — decided, by design.** Teardown goes through `stopDecartSession()`, which keeps the local camera alive: the live preview is the error card's background (same as the quota card). Full camera release only happens on iframe teardown (close button / reload).
2. **Post-reset hysteresis (server side).** Re-arming at the same 0.8 threshold invites repeated latches on a marginal stream. A raised threshold or longer streak for the first seconds after a reset belongs in the pod, and is the same grace period the in-pod version will need.
3. **`GIVE_UP_MESSAGE` is currently unreachable.** With `MAX_RESETS_PER_SESSION: Infinity` the cap never trips, so every cut today is a fresh-cache cut. The string is kept for whenever a finite cap is set.
4. **Model churn behind the alias.** `lucy-vton-3.5` has resolved to `lucy-vton-2` and `lucy-vton-3.5-sparse` at times. Everything here assumes vton-3.5 semantics, so reset-attempt numbers should be filtered by the model that actually served the session.
