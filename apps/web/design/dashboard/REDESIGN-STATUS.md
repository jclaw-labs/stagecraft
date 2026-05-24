# Dashboard redesign — rollout status

The `apps/web` platform surfaces, brought under the shared `AppShell` + the
tokenized panel design language (per the comps in `theme-comps/` and PR #250):

- [x] Dashboard / sites overview + empty state (#253)
- [x] Site detail — `/sites/[id]` (#257)
- [x] Settings — `/settings` (#258)
- [x] Create — `/create` (#259)
- [x] Onboarding — `/onboarding` (Resend gate) (this PR)

**Done — every authenticated surface is now consistent.** `/login` stays a
standalone pre-auth sign-in screen (no app shell), by design.

Deferred polish + DRY items live in `FOLLOWUPS.md` (border-width tokens, a
shared `StatusBadge`, an account dropdown / mobile nav drawer, real site
thumbnails, and a `minimal` AppShell variant for first-run gates).
