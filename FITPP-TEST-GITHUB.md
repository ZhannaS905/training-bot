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
