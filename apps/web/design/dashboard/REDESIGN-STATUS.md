# Dashboard redesign — rollout status

The `apps/web` platform surfaces, brought under the shared `AppShell` + the
tokenized panel design language (per the comps in `theme-comps/` and PR #250):

- [x] Dashboard / sites overview + empty state (#253)
- [x] Site detail — `/sites/[id]` (#257)
- [x] Settings — `/settings` (#258)
- [x] Create — `/create` (this PR)
- [ ] Onboarding — `/onboarding` (Resend gate) — next

`/login` stays a standalone pre-auth sign-in screen (no app shell).

Deferred polish + DRY items live in `FOLLOWUPS.md`.
