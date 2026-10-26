# Pilot attendance revision fix

Actual running source (port 8804):
`/Users/zhserebro/Documents/Codex/2026-10-23/referenced-chatgpt-conversation-this-is-an-8/outputs/max-training-local`.

Confirmed path: FitPP-Test/index.html confirmAttendanceDraft → cloud.js confirmAttendance → POST /api/attendance → src/pilot-server.cjs → Attendance.confirm → transaction set states/main.
The ordinary /api/mutation path already increments _fitppRevision. Attendance.confirm only incremented attendanceRevision; the reducer does not increment the persisted main revision. The frontend's normal persistence transaction is bypassed for this endpoint.

The fix adds `_fitppRevision: raw._fitppRevision + 1` in the same transaction as marks and the attendance receipt. It is outside the marks loop and after the duplicate receipt early return. Existing confirmation, concurrency, identity, booking and time checks are preserved. No bot filter changes.

The actual local src/attendance.cjs has been patched, but its running process was not restarted. For another copy apply integration/fitpp-mediator/pilot-attendance.revision.diff from the Pilot root using `git apply --check` then `git apply`.

To activate locally: stop the existing Pilot server using its launcher, restart src/pilot-server.cjs with the same Node runtime and environment, then reload http://127.0.0.1:8804/fitpp/. Restart discards its in-memory Firebase login. Sign-in and enabling integration must follow the separately approved test procedure; do not enable MAX processing or make a cloud deduction solely to verify this patch. Existing baseline revision 89 does not need manual repair. A future separately authorized single deduction should commit revision 90 if no intervening writes occurred. Start the dry-run baseline before that authorized operation.

Validation: node --test test/*.test.js: 275 passed, 0 failed. New test runs real Attendance.confirm and bundled production pricing reducer against an in-memory transaction; revision 89→90, balance 8→7, one dry-run candidate, duplicate retry has zero writes, unconfirmed/stale requests have zero writes, multiple marks increment once. Removing the fix causes the regression test to fail (89 !== 90). Bundled persistence.js is byte-identical to actual Pilot persistence.js. No cloud writes or MAX sends were performed. Existing uncommitted diagnostic changes in the autopost checkout were preserved and excluded from this fix commit.
