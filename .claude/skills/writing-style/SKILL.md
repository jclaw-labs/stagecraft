---
name: writing-style
description: The user's preferred voice for technical writing — PR bodies, commit messages, docs, design notes, Slack updates, anything prose-shaped. Use when drafting or tightening any user-facing or teammate-facing text. Other skills (e.g. create-pr) reference this for tone and phrasing rules; consult it whenever you write more than a sentence or two of prose for the user.
---

# Writing style

This is how the user writes technical prose. Apply it whenever you draft or edit text on their behalf — PR bodies, commit messages, docs, design notes, Slack messages, code comments longer than a line, replies in this conversation. Treat it as the canonical source of style rules.

## Model

Draft with GPT 5.6 or newer. The rules below are tuned against GPT output, and other models drift from the voice even while following the letter of each one. Don't go by what your own prompt says you are — the `inject-current-model.sh` hook states the real model slug in your context, and that's the one to trust. If it isn't GPT 5.6 or newer, tell the user in one line before you start drafting, then carry on unless they redirect you.

## Voice

Write like a colleague explaining the work at a whiteboard, not like a technical document. Short, plain, conversational.

- **Trust the reader's context, but not your shorthand for it.** They have the code, the diff, the surrounding conventions, and prior conversation, so they don't need citations, qualifiers, or proofs of rigor. They do *not* have your abbreviation for any of it — unpack internal terms and mechanisms (`product_lab_users`, "cross-user write", "tombstone") on first mention, even when the noun looks self-describing to you.
- **Reach for the plain word, not the formal one.** A note to a teammate, not a filing for the record.
- **Lower the register.** If a sentence reads like it belongs in an RFC or a spec, rewrite it.
- **Conversational, not clinical.** Contractions are fine. The occasional "though" or "basically" is fine. Avoid corporate hedges ("it is recommended that…", "consideration should be given to…").

## What to cut

Cut aggressively on edit. The most common forms of waste:

- **Filler that announces what's about to happen** — "this PR…", "I will now…", "in summary…". Just write the thing.
- **Step-by-step narration** of how the artifact was constructed when only the result matters to the reader.
- **Citations of guidelines or conventions** — "per the X guide", "as the docs say", "per convention". State the practice, drop the provenance.
- **Empty intensifiers and adverbs** that don't change meaning — "verbatim", "exactly", "literally", "very", "really".
- **Hedging** that doesn't reflect actual uncertainty — "I think", "it seems", "perhaps". Either you're sure, or the uncertainty is load-bearing and worth naming explicitly.
- **Restating the obvious** — anything the reader can see for themselves in the artifact alongside the writing.

## Abstract up

When several low-level details all support one higher-level point, **state the higher-level point** and let the details support it implicitly. Prefer

> Standardizes the publish flow so validation, UI messaging, and analytics share one state model.

over

> Adds validation in A, B, C; updates UI copy; renames analytics events.

The abstracted version surfaces *why* the change is coherent. The list is just inventory.

## Two-pass drafting

**Pass 1 — draft. Failure mode: missing an important point.**

Get the substance down. For each candidate point ask: does it surface intent, rationale, a non-obvious choice, real risk, or impact the reader can't see otherwise? If yes, include it. Don't over-edit yet.

**Pass 2 — edit. Failure mode: leaving too much in.**

For each sentence/bullet ask:

- Is this important for the reader's understanding?
- Is this non-obvious from what the reader can already see?
- Can it merge into a higher-level statement?
- Can it be deleted with little loss?

Reorder so the most important point appears first. If the writing feels complete but dense, compress further. **Prefer removing content over rephrasing it.**

But compression serves clarity, not the other way around. A sentence can be too short — if cutting a word or collapsing three ideas into one clause makes the reader stop and decode, you've gone too far. "Too dense to parse on one read" is as much a defect as "too long." When a single sentence carries several distinct ideas (it's a cross-user write / check ownership / keep PII out of logs), give each room to land instead of stacking them into one clause-chain.

## Phrasing

- **Self-describing nouns.** Make slug-style or kebab-case references self-evident on first mention. `the 20260424_foo one-off` is opaque; `the 20260424_foo one-off script` is clear in one read. Same with file paths, branch names, ticket IDs — give the reader one extra word so they don't have to guess.
- **Don't stack nouns into adjective piles.** Cramming identifiers and qualifiers into one noun phrase ("a `perk_redeemed` publication-user setting", "the cross-user write block invariant") reads as jargon even when every word is accurate, because the reader has to unwind the stack to find the subject. Break it into a clause that says what the thing *is* or *does* — "the publication-user's `perk_redeemed` flag", "the invariant that blocks cross-user writes". The reader should parse it on one pass without re-reading.
- **Match mood to framing.** When a sentence sets up a conditional ("must X, otherwise Y"), Y belongs in the conditional mood ("Y would happen"), not flat indicative ("Y is happening").
- **Comma over semicolon by default.** Use a semicolon only when the two clauses are contrastive or each could stand alone as its own sentence. For two facts about the same thing, a comma reads lighter.
- **Sentence over fragment** for the lead. Bullets can be fragments; the opening sentence of a section shouldn't be.
- **Avoid emojis and decorative formatting.** Bold and italics earn their use by marking something genuinely important; don't sprinkle them.

## Check before shipping

Before finalizing, re-read the whole piece once at the reader's pace and ask:

- Does the lead earn its place — does the reader know within one sentence what this is about?
- Is anything in here repeated, just phrased differently?
- Does any sentence try to prove rigor instead of conveying information?
- Would a reader who has the code but not my shorthand understand every term on first read?
- If I cut this paragraph, does the reader lose anything?

If a section answers "no" to the first or "yes" to any of the others, fix it before shipping.
