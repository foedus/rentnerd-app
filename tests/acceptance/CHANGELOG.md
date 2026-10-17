# Acceptance test changelog

Changes to locked tests made by the adjudicator (SPEC.md §15.5, step 4). Newest first.

## 2026-10-17 — owner-supervised session (flaky AC-CMP-05 sign-out)
- `helpers/api.ts` `renewBrowserSessions`: a refused sign-in again after a clock move is now logged
  (email, status, body) instead of being dropped silently. Diagnostics only: no assertion, wait or
  behaviour changed. The sign-out itself was an app bug (the web process's clock sync could undo a
  clock move for up to 250 ms), fixed in `src/db/test-clock.ts`.
