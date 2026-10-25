# Training Test: shared webhook

The contact flag no longer selects an exclusive server. The existing direct poll
runtime prepares first; contact linking reuses its authenticated Firebase session
with the existing separate contact write capability. One authenticated webhook
routes group callbacks to the original poll receiver and dialog/start events to
contact linking. The contact queue cannot block group callbacks. Poll persistence,
retry, deduplication and optimistic display code are unchanged.

Scope: the deployed direct receiver supports only yes/cancel for its exact pilot
poll and user. no/maybe are NOT implemented by its storage or domain service.
Routing does not add these states or map them to cancellation.

Deployment was not performed. Before rebuilding only Training Test from
refactor/cleanup-training-bot, verify that its existing direct poll settings are
still present (FITPP_DIRECT_ENABLED=true, FITPP_BRIDGE_ENABLED=true, exact scope,
opened-at timestamp, and separately authorized direct writes). Keep contact flags
and existing credentials, storage, webhook subscription and global publication
flags unchanged. Do not enable booking writes solely to satisfy startup.
An incomplete poll configuration fails startup rather than silently dropping votes.
The pilot poll has its existing expiry; this patch does not extend it.

Manual checks after verified test-only deployment: private /start and signed
request_contact binding; existing pilot yes/cancel callback changes persist and
update the same message; repeat delivery remains idempotent. No test messages or
polls were sent by this change. Production, main and fitpp-crm were not changed.

Validation: 193 offline/mock tests passed, including local HTTP tests. No live
MAX events or Firebase writes were used for validation.
