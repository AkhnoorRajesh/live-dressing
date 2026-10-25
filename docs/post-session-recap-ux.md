# Post-session recap — the screen between "session ended" and what's next

**Requested by:** Revolve. **Shipped for:** every site, not just Revolve.

**Files:** `widget.html` (markup + CSS), `widget-init.js` (`showSessionRecap`,
`_recapHold`, `_proceedToCameraReset`), `widget-core.js` (the parent's `_recapOpen`
hold + the iframe `fullscreen` grant), `recording.js` (`getBlob()`),
`config.js` (`SESSION_RECAP_ENABLED`, `SESSION_RECAP_DISABLED_HOSTS`), `scripts/check.mjs` (check §15)

**Commits:** `b54454d` — feat(widget): replay the session before deciding what's next
(the whole stage: markup, hold contract, fullscreen grant, check §15).
Backend `sql/` counts the four recap events as journey activity in a matching commit
on `decart-try-on-product-backend`.

---

## The request

> We already shipped "export the video of what was just played" — the share icon.
> **Nobody clicks it.**
>
> When a session ends, add a stage before the widget decides what to do next. In
> that stage put a **player** that replays the session on a loop, with real
> controls — pause, seek, hold on a frame, full screen. Under it, a **Close**
> button that triggers whatever would have happened anyway, and next to it
> **Share with a friend**, which does the same download/share we already have.
>
> The reason people want it: while they are trying the garment on, the widget is
> small and they cannot really see how it looked on them.

That last sentence is the whole design brief. Everything below follows from it.

---

## Why the old share affordances failed

There were two, and both asked at the wrong moment.

| Affordance | Where | Why it goes unclicked |
|---|---|---|
| Paper-plane icon (`#session-live-save`) | On the live rail, during the session | The shopper is mid-session and is *being* the video. Sharing is not a thing you do while still performing; and there is nothing to look at yet — the session is not over. |
| "Save your session" link (`#session-save-btn`) | Under the CTAs on the out-of-try-ons card | A small grey underline under two much louder buttons, on a card whose job is selling try-ons. It reads as fine print. |

Neither ever showed the shopper the thing they would be sharing. The recap does
exactly that, and only then asks.

---

## Where the stage sits

The session end is unchanged. What changed is that "what's next" is now
**deferred behind a button** instead of firing on a timer.

```
              session ends (inactivity timeout / garment cap)
                              │
                    ┌─────────┴─────────┐
                    │  is there a       │  no ──► what's next, immediately
                    │  recording?       │         (exactly the old behaviour)
                    └─────────┬─────────┘
                          yes │
                              ▼
                    ┌───────────────────┐
                    │   RECAP STAGE     │   player, looping, real controls
                    │  [Close] [Share]  │   ← the stage this doc is about
                    └─────────┬─────────┘
                        Close │
                              ▼
                        what's next
```

And "what's next" is the same two outcomes it always was — the recap does not
choose between them, it only waits:

| How the widget was opened | What's next (unchanged) | Who does it |
|---|---|---|
| Shopper clicked a garment's try-on button | **Close the widget.** It was summoned for one errand; leaving a panel parked afterwards is clutter. | `widget-core.js` → `_armAutoMinimize` (`_openedFromGarmentClick`) |
| Widget was already open (pill, restore, `DecartWidget.open()`) | **Back to the "drag a garment" screen.** | `widget-core.js` → `DECART_RESET_TO_CAMERA` → iframe reload |

---

## What is on the screen

Full-bleed, not a card. Every other overlay in this widget is a card floating
over the video, because there the video is still the subject. Here the video
**is** the subject — the shopper is on this screen precisely because they could
not see themselves properly in a small widget — so the player gets every pixel
that is not a button. A card would reproduce the problem the screen exists to fix.

| Element | Notes |
|---|---|
| "YOUR TRY-ON" | Quiet label. The video is the content; the heading must not compete. |
| `<video controls loop muted playsinline>` | Native control set, deliberately. Pause, scrub, hold a frame, fullscreen — all four asks, in the one control surface every shopper already knows, on desktop and phone alike. `loop` because a 60-second session ends before you have finished looking at it. `muted` is not cosmetic: the recording has **no audio track at all**, and an unmuted video is refused autoplay, so the loop would open on a frozen first frame. |
| Expand button (top-right) | Element fullscreen where permitted, iOS `webkitEnterFullscreen` next, and finally "grow the widget panel" (`DECART_REQUEST_FULLSCREEN`). See *Fullscreen* below. |
| **Close** (ghost, left) | Runs the what's-next. Always works, even when the video failed. |
| **Share with a friend** (dark fill, right) | `__decartRecording.share()` — OS share sheet on mobile, download on desktop. Identical to the old link; only its placement and prominence changed. |

**Button order and weight.** Close is first in the DOM and on screen because
that is how the request described it, and because the escape hatch should be
where the eye lands first. Share carries the dark fill because the entire stage
exists to get it pressed — and `.session-action-btn`'s own `:first-child` rule
had to be cancelled and re-aimed to make that true, otherwise the emphasis lands
on the button we are trying *not* to push.

---

## Where the recap deliberately does **not** appear

- **The out-of-try-ons card** (`showSessionEnded`). That is a different ending,
  with its own copy and its own CTA, and that card carries the overwhelming
  majority of pay-clicks. Putting a video player in front of it would bury the
  one screen that sells try-ons. It keeps its own "Save your session" link.
- **Error endings** — server disconnect, tab hidden, moderation give-up. These
  all route through `showSessionEnded`, and a celebratory replay of a session
  that just failed is the wrong tone.
- **Sessions with no recording.** Timed out before any garment was applied → no
  video exists → straight to what's next. An empty player is worse than none.

---

## The one subtle thing: the hold

The parent auto-closes a garment-summoned widget ~2 s after it relays
`session_ended`, and again on `DECART_RESET_TO_CAMERA`. Left alone, that timer
would rip the recap away roughly two seconds into the video — on the garment-click
path only, which is the path most shoppers are on.

So the iframe asks the parent to stand down:

```
iframe                                   parent (widget-core.js)
──────                                   ───────────────────────
DECART_SESSION_RECAP {open:true}   ────► _recapOpen = true
                                         _armAutoMinimize() now bails
DECART_TRACK_EVENT session_ended   ────► (would have armed; no-ops)

        … shopper watches, scrubs, shares, takes their time …

[Close]
DECART_SESSION_RECAP {open:false}  ────► _recapOpen = false
DECART_COLLAPSE_FULLSCREEN         ────► collapse
DECART_RESET_TO_CAMERA             ────► the SAME decision as before
```

The parent's decision logic is untouched — only its timing moved. That is the
whole point: this feature must not be able to change *what* happens next, only
*when* it is allowed to happen.

Two rules fall out of it, and check §15 enforces both:

1. **Every early return in `showSessionRecap()` must release the hold.** The
   caller posts the hold before it can know the screen will render. A hold left
   standing suppresses the parent's auto-close permanently, parking a
   garment-summoned widget on a dead session with no way out.
2. **`_recapOpen` must be cleared on iframe load and on close**, or a hold
   outlives the document that asked for it and mutes the *next* session's
   auto-close.

Verified ordering (driven, in a real iframe): the hold is posted at index 4 and
the `session_ended` relay at index 5 — the hold always wins. The parent clears
any armed timer on receipt anyway; ordering is belt, that is braces.

---

## Fullscreen

Fullscreen inside an iframe is the **embedder's** grant, never the frame's own.
Without it, `document.fullscreenEnabled` is false, `requestFullscreen()` rejects,
and the native control's fullscreen button is dead — with no error the iframe can
tell apart from a user cancelling the prompt. So:

- `widget-core.js` now names `fullscreen 'src' https://anywear.decart.ai` in the
  iframe `allow` list (same `'src'` + redirect-target pair as camera and
  microphone, for the same 307 reason) and sets `allowFullscreen`.
- If the document still is not allowed it (an embedder blocking it further up),
  `nofullscreen` is added to `controlsList` so no dead native button ships, and
  the expand button falls back to growing the widget panel.
- That fallback is guarded on the shared `_inFullscreen` tracker, because
  `DECART_REQUEST_FULLSCREEN` is a **toggle** at the parent — sending it while
  already expanded would shrink the video of someone who just pressed expand.

---

## The WebM duration trap

`MediaRecorder` writes WebM as a live stream with **no duration in the header**.
Chrome reports `duration === Infinity` until the file has been played through,
which leaves the native scrub bar with no end and no draggable thumb — i.e. "go
to a specific time", half of what the client asked for, silently missing.

`fixInfiniteDuration()` does the standard dance: seek far past any real end
(`currentTime = 1e101`), let the browser resolve the true duration to clamp it,
rewind to 0 on the first `timeupdate`. Two details that are easy to get wrong and
were caught in the driven harness, not in review:

- `loop` must be lifted for the round trip, or the seek reads as "reached the
  end, start over";
- reaching the end **pauses** the video, so playback has to be restarted
  afterwards — without that the recap opens on a frozen first frame, which is
  exactly the "nothing is happening" impression the screen exists to avoid.

No-ops on Safari/iOS, where the recording is a real `.mp4` with a duration.

---

## Measuring whether it worked

The premise of the request is a number: almost nobody clicked the old share. So
the stage has to be measurable against it.

| Event | Fires when | Use |
|---|---|---|
| `session_recap_shown` | The stage opens (`reason`, `images_tried`) | Denominator. Every recap-eligible session end. |
| `session_recap_share_clicked` | "Share with a friend" | **The number.** `share_clicked / shown` vs. the old `session_save_clicked` and `session_live_save_clicked` rates. |
| `session_recap_fullscreen_clicked` | Expand pressed | Tests the client's stated reason — "the screen is too small". A high rate is evidence they were right. |
| `session_recap_closed` | Close pressed (`watched_ms`, `shared`) | How long people actually watch, and whether watching longer predicts sharing. |

`watched_ms` is the honest one: if it clusters at "under two seconds", the stage
is an obstacle rather than a feature and should be reconsidered, not tuned.

---

## Turning it off

`SESSION_RECAP_ENABLED: false` in `config.js` → session end goes straight to
what's next, exactly as before this feature. It also requires
`RECORDING_ENABLED`; with no recording there is nothing to replay.

**For one site only** 👉 add its hostname to `SESSION_RECAP_DISABLED_HOSTS` in
`config.js`. A listed domain also covers its subdomains (`uniqlo.com` →
`www.uniqlo.com`, `jp.uniqlo.com`), matched on a dot boundary against the
retailer's page host (`_cpHost()`), not the widget's origin. On a listed site
the stage is skipped exactly as with the global switch off — no recap events
fire there, so a site's `session_recap_*` counts dropping to zero after the
release is this list, not shoppers ignoring the screen.

| Host | Off since | Why |
|---|---|---|
| `uniqlo.com` | 2026-09-30 | Requested — replay after session end turned off on Uniqlo. |

It is a client config, so it takes effect as the fleet updates (extension
release) and on the next web-widget deploy — there is no server switch.

---

## Known gaps

- **Not verified on a real store.** The stage, the player, the hold contract and
  the skip path are all driven in a headless harness against the real files
  (real `MediaRecorder`, real inactivity timer, real message relay). What is not
  yet exercised on a live site is the *garment-click* auto-close specifically —
  it needs a page with try-on buttons. Worth one smoke test per `TESTING.md` §2.
- **Desktop download vs. an immediate Close.** Pressing Share (desktop → file
  download) and then Close straight away destroys the iframe while the download
  is starting. Chrome keeps the blob alive for the download job, and the old
  save link had the same shape with a *2-second* auto-close behind it, so this
  is not a regression — but it is untested.
- The recap covers the footer while it is up, so the billing/"Your plan" button
  is unreachable for the duration of the stage. Deliberate; it comes back on Close.
