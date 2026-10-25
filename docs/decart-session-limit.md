# Decart refused a seat our queue gave us

**Commits:** see `git log -- dev/_widget_entry.js` for "back in line when Decart refuses"
(2026-10-13). Backend half: `DECART_SESSION_LIMIT.md` in decart-try-on-product-backend.

## The problem

Two things limit concurrency: the backend queue, and Decart's per-API-key session
limit. They count differently (a seat the queue freed is one Decart may still be
tearing down), so at the edge of the cap a shopper the queue ADMITTED is refused
with `"Concurrent session limit reached."`.

We measured 2026-10-13 (backend `events` + `session_queue`):

| | |
|---|---|
| refused shoppers | 372 (1,068 `widget_error` rows) |
| when | only with 5+ of 8 seats taken: 0.7% of admissions at 0–4 other seats, 8.7% at 7 |
| healed by the SDK's own retries within seconds | 464 of 493 bursts |
| ended in "Servers busy" | 8 |
| ended in a silent return to the camera view | 10 |

## Why the widget could not see it

The SDK (0.1.22) forwards a server `error` message to the client's `error` event,
but the client's events are BUFFERED until `connect()` resolves. A refusal during
the SDK's retry loop is therefore invisible until a retry succeeds, and then all
the buffered errors fire at once. That is why `realtime_error` rows arrive 2–3 in
the same millisecond as `webrtc_connected`: those are refusals the SDK already got
past, not a second connection.

`moderation-reset-attempt.js` already listens on every signaling socket (for
`content_flag`). It now also stamps `window.__decartSessionLimitAt` on a
session-limit `error` message. That is the widget's only live view of it.

## What happens now

1. The SDK retries as before (1, 2, 4, 8, 10 s). Most refusals end here.
2. If the attempt still fails, by the 20 s connect timer or by `connect()`
   rejecting, and a refusal was seen since the attempt began,
   `_requeueAfterRefusal(ticket)`:
   - POSTs `/api/queue/requeue {ticket_id, reason:'session_limit'}`;
   - stops the heartbeat WITHOUT leaving the ticket (leaving would drop us out of
     the line we are being put at the front of);
   - sets `_pendingRequeue` and starts a fresh `connectToAI()`, which resumes the
     wait (`fetchDecartTokenViaQueue({ resume })`) with "You're #1 in line".
3. The backend holds the key's cap at the seats Decart was full at for 20 s, so the
   next freed seat goes to this shopper rather than to another refusal.
4. `widget-init.js`'s first-frame watchdog also runs out at ~20 s from admission
   and would show "Servers busy" first, after which the re-admitted attempt
   discards its own stream. When a session-limit refusal was stamped in its
   window it waits 5 s more, once per wait, so the bundle's timer requeues first.
5. Up to 3 times per try-on (`QUEUE_MAX_REQUEUES`; the server refuses a 4th). Then,
   or if the server will not take the ticket back (`queue_requeue_refused`), the
   old ending: busy card or camera view.

## Events

| Event | Meaning |
|---|---|
| `queue_requeued {requeues}` | the ticket is back at the front |
| `queue_requeue_completed {queue_duration_ms}` / `queue_requeue_timeout` | the second wait ended in a seat / gave up |
| `queue_requeue_refused {reason}` | not put back (`unsupported` = backend SQL not pasted) |
| `connection_timeout.session_limit_seen` | the timer ran out on session-limit refusals |

The second wait never emits `queue_entered` / `queue_completed` / `queue_timeout`:
the backend's Up time card and try-on alarm count ONE wait per try-on.

## Deliberately not done

- **SDK retries off** (Decart's advice for apps with their own queue). The advice
  assumes the dialer holds no seat in that queue; ours does, and the retries are
  what absorb Decart's teardown lag (the 464).
- **Requeue on the first refusal.** That turns a 2-second hiccup into a trip
  through the line.
- **SDK upgrade to 0.2.x** (terminal session-limit, `onCapacityWait`). A separate
  change, with real-device testing.

## Unverified

Driven only by static checks here (`npm run check`); the requeue path itself is
driven end to end on the backend's own pages (`npm run test:moderation`), which
share the route and the semantics. Not yet run against a real refusal in a
loaded extension.
