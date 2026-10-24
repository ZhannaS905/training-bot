# Training Test: RAM projection

Scope: `refactor/cleanup-training-bot`, base `b70a439ecaf889d3ff9ec8d3f06c4c901f852139`.
Only the existing exact test poll can be edited. No publication, production, Rules,
payment, subscription or attendance changes. No deployment or real messages performed.

## Processing

Startup awaits a validated `/bot/poll-view` snapshot with `optimistic:true` and
repairs the existing MAX message. Missing/unreadable state fails startup; it is
never replaced by an assumed empty poll. BotHost receives only participants and
the existing scoped reciprocal binding, not the client collection. Names come
from the mediator's confirmed card/binding checks, never MAX profiles.

A valid warm callback overlays RAM synchronously and schedules the guarded MAX
GET/PUT. Firebase saving runs independently on its own serial queue; neither a
Firebase read nor its write result gates the first display. MAX edits use one
serial queue across callbacks, recovery and background reconciliation. Its
existing MID/chat/owner/keyboard verification still precedes every edit.

Pending intents are ordered by event time, duplicate in-flight IDs share work,
and authoritative timestamp/idempotency checks remain in the mediator. A newer
pending action survives an older save confirmation. A generation check rejects
snapshots started before newer events. The 30-second reconciliation skips pending
writes, and an authoritative read runs after the queue settles. External app
bookings are incorporated there. Failed/ambiguous saves disable fast processing
until recovery, remove their overlay, and return webhook failure for redelivery.
If rereading fails, the last confirmed local state is used for best-effort rollback.
MAX failures do not stop persistence; correction and subsequent timer retries
repair the projection. At most 256 in-flight IDs are accepted; excess is retryable.

Webhook HTTP 200 waits for the mediator response (and correction); there is no
RAM-only acknowledged persistence queue. Crash before acknowledgement relies on
MAX redelivery, with mediator durable deduplication/order checks. RAM alone cannot
guarantee delivery if the sender exhausts retries. After restart the projection
is rebuilt from Firebase, including writes that committed before a lost response.
The existing mediator's transactional update response must mean durable commit.

The currently authorized test policy admits **one exact MAX user**, unchanged.
Other recorded participants and concurrent app changes are preserved. Callbacks
from other users remain rejected; this is not a multi-user rollout. Run one bot
instance for this exact poll; multiple replicas need shared ordering/fencing.
No-op, stale or missing/invalid binding callbacks use confirmed processing;
they do not obtain a fresh name before a speculative PUT. No speculative PUT is
made in this fallback. Binding revocations are picked up by reconciliation and
always checked by the authoritative save; RAM may briefly show an intent that
that check rejects. UI display is not durable booking confirmation.

## Local mediator

No new endpoint or schema is required if the mediator already has the previous
optimistic-context integration. Verify `/bot/poll-view` accepts `optimistic:true`
and returns `optimistic` from the same transaction as participants and revision.
For an older mediator, install/review the existing repository files
`integration/fitpp-mediator/optimistic-context.cjs`, `poll-view.cjs` and the existing
`pilot-server.optimistic.diff` in the **local FitPP-Test mediator only**. Restart
that local mediator after updating it. Missing context keeps the confirmed
fallback working but disables the RAM speedup. No mediator was changed or
restarted in this task. Do not alter Firebase Rules.

## Offline verification

Run Node >=22:

```
node --test test/*.test.js
node scripts/benchmark-fitpp-ram.cjs
```

The benchmark is fully simulated, with 80ms Firebase reads, 180ms saves,
7ms MAX verification and 55ms MAX PUT. Five samples: old first successful PUT
145–158ms (median 146ms); RAM 65–66ms (median 65ms). Reads before that PUT:
1 versus 0. These are offline measurements, not real BotHost/MAX latency.
The network GET and PUT remain unavoidable. The diagnostic `fitpp_ram_first_put`
records callback receipt to successful warm display completion without identities
or names. `edited:false` reports a null PUT duration (coalesced/no change).

## Test launch — requires separate authorization

1. Check the test branch commit and the local test mediator snapshot support above.
2. Keep the same test token, expected bot ID, chat, MID, UUID, binding and buttons.
   Keep `BOT_MODE=test`, `FITPP_BRIDGE_ENABLED=true`,
   `FITPP_POLL_SYNC_ENABLED=true`, and `AUTO_PUBLISH`, `TEST_ALLOW_SEND`,
   `TEST_ALLOW_EDIT`, `TEST_ALLOW_DELETE` all `false`. The exact scoped PUT is
   separately guarded; do not enable generic editing/publication.
3. Confirm only one test instance runs. Building/restarting on BotHost is a
   deployment and is deliberately not done here. Startup itself may repair the
   existing MAX message: obtain approval before launching it.
4. After authorization, start the local test mediator, then deploy/start this
   commit with the existing `node memory-training-test.cjs` entrypoint. Startup
   must succeed with the existing poll; never publish a replacement on failure.
5. Click yes/cancel and compare `fitpp_ram_first_put.firstPutMs` with the earlier
   real 1443–1531ms logs. Confirm eventual Firebase/MAX agreement, duplicates,
   quick reversal and restart/redelivery. Test failure injection offline first.
6. To roll back, stop this single test instance, restore the base test commit,
   and restart only after authorization. Do not reset Firebase bookings or MID.

The commit is local only: pushing a connected BotHost branch might trigger a
rebuild/deployment, so no push is performed under the no-deploy instruction.
