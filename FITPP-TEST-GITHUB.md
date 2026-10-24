# Training Test: GitHub deployment

Deploy only branch refactor/cleanup-training-bot to the existing Training Test BotHost profile. Never deploy this change to the working bot.

The Docker build includes the optional src/fitpp-test-bridge.js module. Without FITPP_BRIDGE_ENABLED=true, the existing memory-test entrypoint is unchanged. When enabled, the bridge keeps existing test bot/chat/membership verification and the existing /webhook secret check. It runs no scheduler, message creation, edit or deletion operations.

Required runtime variables (values belong in the test profile, not Git):
- FITPP_BRIDGE_ENABLED=true
- FITPP_BRIDGE_URL: the approved HTTPS mediator /bot/update URL, without query parameters
- FITPP_BRIDGE_SCOPE: JSON with chat, user, mid, uuid; one exact agreed test poll/user
- FITPP_BRIDGE_HMAC_KEY: existing shared HMAC secret; never commit or log it
- AUTO_PUBLISH=false, TEST_ALLOW_SEND=false, TEST_ALLOW_EDIT=false, TEST_ALLOW_DELETE=false

Retain BOT_MODE=test, CHAT_IDS, existing test bot token, TEST_EXPECTED_BOT_ID, WEBHOOK_SECRET and trusted CA settings. The bridge does not change subscriptions or the existing webhook URL. It signs only minimal callback metadata: identifiers, choice and timestamps. Names, message text and MAX/Firebase tokens are never forwarded.

In BotHost choose Repository → the existing repository and exact test branch → Save and rebuild. This is the normal Git build route; it does not use the unsupported local rebuild-from-files agent command. Existing environment variables, domain and data directory are retained by the panel.

Readiness: GET /health returns mode fitpp-test-exact-poll-bridge. Do not click MAX buttons until the mediator is separately signed in and enabled. No Firebase initialization is part of this deployment, and the existing four auxiliary documents must not be recreated.

Disable immediately using the mediator's local Stop button; subsequent callbacks fail without cloud changes. For deployment rollback set FITPP_BRIDGE_ENABLED=false and restore the previous test-branch revision. No production/main changes are needed.


## Existing poll participant display

The optional FITPP_POLL_SYNC_ENABLED=true mode edits only the configured existing poll MID, using the existing MaxApi.edit PUT method. TEST_ALLOW_EDIT remains false: the new scoped editPollText facade verifies the message sender, test chat, MID and exact two callback UUID payloads before editing. Only text/format/notify=false are sent; attachments are omitted to preserve the existing buttons byte-for-byte. No new messages, polls or subscriptions are created.

The mediator supplies a signed-request-only /bot/poll-view endpoint reading main, bookings and bookingClock in one client SDK transaction. Participant names are the fictional FitPP client card names, not callback profile names. Only matching booked client IDs for the exact date/hall are included. Payments, visits, subscription counts and all documents remain unchanged by projection reads. There is no duplicate participant list or durable state on BotHost.

After each successful callback (including duplicates), display is rebuilt from the latest projection, not the historical callback result. A read-only reconciliation runs on startup and every thirty seconds, recovering after MAX failures, lost responses, UI changes and bot restarts. The actual MAX text is re-read; matching HTML/plain-text forms do not trigger another edit. Concurrent changes detected after an edit cause a new projection/read/edit pass. The list is eventually consistent across the external MAX API; no cross-service atomic transaction is claimed.

Deployment order:
1. Copy integration/fitpp-mediator/poll-view.cjs into the existing local mediator src/ and apply pilot-server.poll-view.diff to that same mediator. These sources are already prepared in the task workspace. No Rules/IAM or auxiliary-document changes.
2. Restart the mediator, sign in on 8804, reuse the existing matching bindings preserving openedAt, and enable. Keep its working HTTPS URL.
3. Rebuild only Training Test from refactor/cleanup-training-bot. Set FITPP_POLL_SYNC_ENABLED=true in that test profile, keeping existing scope, token, webhook secret and HMAC secret. GET /health must show pollDisplaySync=true. Without the new flag, the currently working booking integration keeps its previous behavior.
4. Test the existing poll: yes adds the FitPP name and count 1; repeated yes has no duplicate; cancel removes it and shows count 0. Stop/restart the test bot or simulate a failed PUT in a controlled test: reconciliation must rebuild from current Firestore bookings, not old votes. The original MID and button payloads must stay unchanged.

A working Firebase session and reachable HTTPS mediator are still required. If the mediator is unavailable, no cached participant list is used; MAX display waits and retries. Names from MAX profiles are deliberately not persisted or transmitted.

### Thirty-second reconciliation and latency diagnostics

Immediate callback synchronization and startup reconciliation are retained. Idle fallback ticks every 30000ms. One shared queue serializes callback processing and reconciliation; busy timer ticks are skipped rather than queued. Unchanged MAX text produces no PUT. Successful background checks with puts=0 are silent; changes, failures and callback diagnostics remain visible.

In healthy, unchanged idle state each tick makes one /bot/poll-view request, which reads main, bookings and bookingClock in one client SDK read-only transaction. This means two projection transactions and six requested document reads per minute (plus one startup pass). These are application reads, not an assertion about Firestore billing, SDK transaction RPC counts/retries or rule-dependent reads. After a PUT, a second projection is still read to detect concurrent Firestore changes. Callback traffic, changes and retries add reads.

The scoped syncPollText method reads the existing MAX message once, checks MID, owner, chat and the exact callback button payloads, compares text, then immediately issues PUT only if needed. There is no reusable cached verification or external caller-supplied verification proof. Attachments remain omitted. The previous extra GET before PUT has been removed; the existing 550ms API pacing and shared edit queue remain unchanged.

Timing logs contain no identifiers, names, tokens or event bodies. fitpp_test_booking reports queueWaitMs, bridgeUpdateMs (mediator round trip including Firebase processing), syncMs and totalMs. fitpp_poll_sync reports pollViewMs, maxVerifyMs (message GET and full scope/keyboard verification), maxPutMs (PUT including API pacing), puts and totalMs. Successful callback diagnostics include puts=0. maxPutMs is not pure server execution time: it includes network and any wait for the existing API limiter. Previously maxEditMs included both a redundant verification GET and PUT, each potentially subject to the 550ms limiter. Real post-optimization timing requires a user callback after rebuilding Training Test; local tests do not predict MAX network latency.

### Optimistic participant display (prepared; no deployment)

The Training Test receiver can temporarily render a fresh Firestore snapshot with only the confirmed bound client's choice changed, while the existing signed /bot/update request runs in parallel. The preview explicitly says the change is NOT confirmed by FitPP and uses a provisional list heading. The client name comes only from main. All other participants in that snapshot remain present. Every successful or failed Firebase request is followed by authoritative reconciliation after the preview request settles. No concurrent PUTs, new messages, new polls, new persistent participant cache or Firestore schema/rules changes are introduced. The existing 550ms API pacing, exact test scope, message owner/chat/MID/keyboard checks, startup reconciliation and 30-second background recovery remain.

The mediator extension reads both binding directions, the persisted poll/openedAt and the target bookingVersion in the same read-only SDK transaction as main/bookings/bookingClock. Only the already approved user 5819064 is eligible; this does not enable additional live users. The service's durable event ordering/deduplication remains unchanged. An event at or before the persisted lastEventAt, a missing/unverified binding, mismatched poll, closed/cancelled workout or unavailable optimistic context uses the previous confirmed-only path. A fresh snapshot is fetched for each callback rather than trusting a cache that another FitPP writer could have invalidated. There is no cross-service atomicity: temporary previews can differ from concurrent external actions and are then corrected from Firestore. If correction is unavailable, webhook retry/startup/30-second reconciliation recovers from Firestore without any saved BotHost list.

Before enabling previews, copy BOTH integration/fitpp-mediator/poll-view.cjs and optimistic-context.cjs to the existing mediator src/, and apply pilot-server.optimistic.diff to the already poll-view-enabled server. The previous initial pilot-server.poll-view.diff is for the old pre-projection server only. Keep the same secret, HTTPS endpoint, SDK, UID and four existing bindings. Restart/sign in/reuse existing bindings as usual. Without the mediator extension the new bot safely falls back to confirmed-only rendering. The repository includes prepared sources only; the working mediator and BotHost are not modified by this commit.

On a normal transition there may be two PUTs: visibly provisional text and confirmed text. Existing API pacing limits their frequency, and a shared queue serializes actions from callbacks and background checks. Idle checks are unchanged: two projection transactions per minute, three document reads each. An optimistic preflight adds one read-only seven-document transaction per callback (four existing auxiliary documents in addition to the usual three); no auxiliary document is modified by preflight.

Safe diagnostic event fitpp_optimistic_timing contains firstPutMs (callback receipt to first acknowledged successful PUT, null if none), firebaseConfirmMs (receipt to successful mediator response, null on failure), firebaseSettlementMs (including failed response), finalSyncMs, finalPuts, correctiveUpdates, optimisticUsed, previewFailed, firebaseConfirmed, firebaseApplied and reconciled. firebaseConfirmed denotes a successful API response; firebaseApplied distinguishes a newly applied event from a stale/duplicate result. correctiveUpdates counts successful final PUTs that correct divergent confirmed data or roll back a failed write; simply removing the provisional marker after a matching success is counted in finalPuts but not correctiveUpdates. Counts survive a subsequent verification-read failure within that operation; no cross-process metrics persistence is claimed. No names, identifiers, event payloads or secrets are logged. Actual latency improvement must be measured after an authorized rebuild and user callback; a slow MAX API can still dominate.

### Nonblocking startup and MAX-first RAM flow

Snapshot recovery now runs in the reconciliation loop after identity/configuration checks, without delaying the HTTP listener. A failed recovery preserves the existing MAX message; it never creates an empty poll. `/health` includes `pollDisplayReady`: wait for `true` before testing the immediate display. Without a verified snapshot/binding the receiver safely uses the confirmed-only path; it cannot invent the participant name during a cold bridge outage.

For a warm verified binding, RAM schedules the existing scoped MAX edit immediately and completes that attempt before starting the serialized mediator write. The name appears under a provisional heading with an explicit pending-save note. Only a successful durable write plus reconciliation removes the note. Failed/ambiguous persistence returns webhook 503 for redelivery, rolls back the local overlay, and disables the fast path until authoritative recovery. Callback IDs, timestamps, the existing service deduplication and per-poll write/display queues preserve ordering. Background recovery retries every 30 seconds; no new poll is published.

`integration/fitpp-mediator/request-diagnostic.cjs` and `pilot-server.diagnostic.diff` prepare allowlisted rejection logging for the separate local mediator. They are not automatically installed or restarted by the bot deployment. Copy the helper to the mediator's `src/` and review/apply the diff against its current source when a separate mediator update is authorized. Only fixed codes/route labels are logged, never arbitrary errors or payloads. The old handler did not retain rejection reasons, so past HTTP 403 responses cannot be reliably attributed from its existing logs.

Live check after explicit deployment approval: use only Training Test and this branch; keep the existing 26 October 20:00 Zarya poll (`mid.ffffb6ed054c9f4801a169a000563611`, UUID `99732d34-b609-4266-9418-f12de9b3fe62`). Wait for `pollDisplayReady:true`, press Yes then Cancel, and verify immediate name addition/removal followed by removal of the pending marker and matching test FitPP bookings. No live write or deployment is part of the local test suite.
