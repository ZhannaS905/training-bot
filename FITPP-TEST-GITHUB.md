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

After each successful callback (including duplicates), display is rebuilt from the latest projection, not the historical callback result. A read-only reconciliation runs on startup and every five seconds, recovering after MAX failures, lost responses, UI changes and bot restarts. The actual MAX text is re-read; matching HTML/plain-text forms do not trigger another edit. Concurrent changes detected after an edit cause a new projection/read/edit pass. The list is eventually consistent across the external MAX API; no cross-service atomic transaction is claimed.

Deployment order:
1. Copy integration/fitpp-mediator/poll-view.cjs into the existing local mediator src/ and apply pilot-server.poll-view.diff to that same mediator. These sources are already prepared in the task workspace. No Rules/IAM or auxiliary-document changes.
2. Restart the mediator, sign in on 8804, reuse the existing matching bindings preserving openedAt, and enable. Keep its working HTTPS URL.
3. Rebuild only Training Test from refactor/cleanup-training-bot. Set FITPP_POLL_SYNC_ENABLED=true in that test profile, keeping existing scope, token, webhook secret and HMAC secret. GET /health must show pollDisplaySync=true. Without the new flag, the currently working booking integration keeps its previous behavior.
4. Test the existing poll: yes adds the FitPP name and count 1; repeated yes has no duplicate; cancel removes it and shows count 0. Stop/restart the test bot or simulate a failed PUT in a controlled test: reconciliation must rebuild from current Firestore bookings, not old votes. The original MID and button payloads must stay unchanged.

A working Firebase session and reachable HTTPS mediator are still required. If the mediator is unavailable, no cached participant list is used; MAX display waits and retries. Names from MAX profiles are deliberately not persisted or transmitted.
