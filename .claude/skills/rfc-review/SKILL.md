---
name: rfc-review
description: Critical review of an RFC, design doc, or proposal — checks prose clarity, design soundness, and what's missing. Use when the user asks to review an RFC, design doc, proposal, or spec; says "tear this apart", "what am I missing", "look hard at this doc"; or uses /rfc-review. Goes beyond proofreading to challenge design decisions and surface gaps a reviewer is likely to raise.
---

# RFC Review

A critical pass on a written design — the kind a senior teammate would give before you take the doc to a wider audience. Push back where the doc is weak; don't rubber-stamp.

## Arguments

`/rfc-review <Notion URL>` — review the RFC at that Notion link
`/rfc-review` — review the most recently mentioned RFC in this conversation

This skill only operates on RFCs hosted in Notion. If the user invokes it without a Notion link and no Notion URL is in scrollback, ask for one before doing anything else. Do not attempt to review against a local path, a Google Doc, a Linear description, or any other source — request a Notion link instead.

## Step 0: Environment preflight

Before reading the RFC, confirm the environment can actually reach Notion:

1. **Check for Notion access.** Verify Notion MCP tools (e.g. the `Notion` server's `search` / page-fetch tools) are available and authenticated in this session. If they are not — no Notion MCP server is connected, the server is in `needsAuth`/`error` state, or no Notion-capable tool exists — **stop and fail loudly**. Tell the user the skill requires a connected Notion MCP server and ask them to authenticate it in Cursor (Settings → MCP) before re-running.
2. **Fetch the RFC page.** Resolve the provided Notion link to a page and load its content (and any child pages it relies on). If the page fetch fails — 404, permission denied, the integration isn't shared into the page, or the URL is malformed — **stop and fail loudly**. Surface the exact error and ask the user to either share the page with the Notion integration or provide a different link. Do not fall back to guessing at the RFC's contents from the URL slug, the conversation, or partial context.

Only proceed to Step 1 once the full RFC body has been retrieved from Notion.

## Step 1: Gather context

1. **Read the RFC in full.** Don't skim. The lead, the open questions, the alternatives — read all of it before forming opinions.
2. **Follow the links.** If the RFC references a PR, Linear ticket, Figma, prior RFC, sub-pages in Notion, or specific source files, read those too. Your job is to check the doc against reality, not just the prose against itself. If a claim references code, verify the code matches. If a linked Notion sub-page can't be fetched, call that out explicitly rather than guessing.
3. **Note the audience.** A doc going to one reviewer is different from one going to a full team or a cross-functional group. The reading order, the level of detail, and what counts as "obvious" all shift.

## Step 2: Prose

For each section, ask:

- **Lead.** Does the first sentence of the section tell me what this is and why, or do I have to read three sentences to find out?
- **Repetition.** Is the same point made in two places with different wording?
- **Padding.** Are there sentences that don't change the meaning if cut?
- **Unbacked claims.** Anything asserted without a code reference, benchmark, number, or link that should have one?
- **Rigor performance.** Anywhere the writing tries to prove thoroughness ("verbatim", "as convention dictates", "per the X guide") instead of conveying information?
- **Mood match.** Does conditional framing land in conditional mood ("Y would happen") instead of flat indicative ("Y is happening")?

## Step 3: Design

Think through each of these. Skip what's irrelevant, don't skip what's merely subtle.

### API shape and naming

- What would a future maintainer regret about the names, default behavior, or extension points?
- Is the contract loose where it should be tight (or vice versa)?
- What's hard to change later if this ships as-written?

### Edge cases the doc skips

- Empty inputs, concurrent writes, failure mid-flight, partial rollout, missing permissions, race conditions, the off-by-one cases at boundaries.
- The doc doesn't have to handle every case in writing — but the cases it skips should be conscious skips, not blind spots.

### Alternatives

- Are the alternatives genuinely weighed, or strawman'd to make the chosen path look obvious?
- Is there a real alternative the doc doesn't mention that a reviewer is likely to bring up?

### What's not in the doc

- **Rollout** — site config, experiment, kill-switch, deploy order, migration story.
- **Security / authz** — who can do this, server-side enforcement, data exposure surfaces (logs, analytics, queues).
- **Performance** — query patterns, caching, fan-out, scale assumptions, cost.
- **Observability** — metrics, logs, error attribution, how on-call will debug this.
- **Testing** — what the regression looks like, what's hard to test, what proves the thing actually works.
- **Deprecation** — what's being replaced, when the old thing goes away, who owns the migration.

### Forward-looking

- Given this design, are the next 2–3 likely changes easy or painful?
- Are there coupling points that will force shotgun surgery when requirements shift?
- Are there assumptions about scale, tenancy, or topology that may not hold?

## Step 4: Open questions

- Are any of the doc's open questions already answered elsewhere in the doc? They should be closed out instead.
- Are there obvious questions a reviewer is likely to raise that the doc doesn't flag?
- Do the open questions name a specific reviewer when one is needed, or are they floating?

## Output format

**Summary** — one paragraph: what the doc gets right, and the single most important thing to address before sharing it wider.

**Must address** — gaps or design issues that will derail review or cause real problems if shipped.

**Should address** — choices that will draw friction in review but aren't dangerous.

**Consider** — judgment-call suggestions and prose tightening.

**What's working well** — non-obvious good decisions worth keeping. Not filler — call out the things you'd be tempted to redesign and decided not to. Skip if there's nothing load-bearing to say.

For each finding, name the section, explain _why_ it matters, and propose a concrete alternative when you have one. Sort within each group by impact — biggest first, nits last.

Don't summarize the doc back. Don't open with "great RFC overall". Respect the author's time.
