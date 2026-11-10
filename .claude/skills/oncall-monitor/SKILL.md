---
name: oncall-monitor
description: Watch Substack's on-call Slack channels for me during my on-call week, tell me through my own Slack bot when something needs action, and talk the issues through with me in that bot's DM. Use when I say I'm on call and ask you to monitor, watch, or keep an eye on dev-ops, alerts, or Sentry, or to "be my on-call helper". Runs only in a Claude Code cloud session; started anywhere else, it hands off to one.
---

# On-call monitor

I'm on call. You read the on-call channels on a timer, decide what actually needs me, and tell me in my DM with my Slack bot, where I get a notification. I can reply there, at the top level or in a thread, and you answer the same way. You don't fix anything on your own, and you never speak for me in a shared channel.

## It runs in the cloud

The loop lives on scheduled messages that wake a Claude Code cloud session (claude.ai/code, `CLAUDE_CODE_REMOTE=true`). A laptop sleeps and a local session dies with its terminal. A cloud session keeps its scheduled messages across container restarts and keeps going while I'm away from the machine.

So check `CLAUDE_CODE_REMOTE` before anything else:

- **`true`:** carry on below.
- **Anything else:** don't start any loop here. If the `create_session` tool from the `claude-code-remote` server is available, use it to start a cloud session on `https://github.com/substackinc/substack`. Give it this prompt: "I'm on call this week. Attach the `jclaw-labs/local-config` repository with `add_repo`, then use its `oncall-monitor` skill to monitor the on-call channels for me." Then tell me the session's link. If that tool isn't available, tell me to start a Claude Code session on claude.ai/code with the Substack repo and paste that same prompt. Stop there either way.

The cloud session needs the Slack MCP connector, and it needs the `send_later`, `create_trigger` and `list_triggers` tools from `claude-code-remote`. If Slack is missing, read the environment docs (`read_documentation` with topic `connectors.add`) and tell me what to connect. Without the scheduling tools there's no loop, so say that and stop.

## Setup

Do this once per session, and tell me in one short message what you set up.

### My identity in Slack

- **My user ID:** the Slack search tool's description names the logged-in user ("Current logged in user's user_id is …"). That's me.
- **My bot DM:** the DM where my bot's messages land. I'm the only human in it, so it's my self-DM. Find it by reading recent messages from my bot, or ask me for the channel ID.

### My bot's webhook

Post to me through my bot's Slack incoming webhook, never as me. A message posted as me doesn't notify me, and that's how this setup started: I asked for a bot because I couldn't see the messages.

- Ask me for the webhook URL if this session doesn't have it yet. I can find it in the bot's app settings under Incoming Webhooks.
- Save it to `<scratchpad>/oncall/webhook` and `chmod 600` it. Never print it, echo it, log it, or commit it, including in a scheduled message's text. Read it with `$(cat …)` inside the curl command.
- Don't use `SLACK_BOT_TOKEN` or any other token from the environment. In my sessions it has belonged to a different bot.
- Post a one-line "monitoring is on" test message before the first poll, so a bad URL shows up now and not mid-incident.

Post like this:

```bash
python3 -c 'import json,sys; json.dump({"text": sys.argv[1]}, open("payload.json","w"))' "$msg"
curl -sS -X POST -H 'Content-type: application/json' --data @payload.json "$(cat <scratchpad>/oncall/webhook)"
```

Add `"thread_ts": "<parent ts>"` to the JSON to reply in a thread. Webhooks support it.

### Channels

| Channel | ID | What shows up there |
| --- | --- | --- |
| #dev-ops | C0138S908AC | Zuma, Modal and Imginary deploys, site config changes, people asking on-call for things |
| #dev-ops-alerts | C049LP2NMHQ | Datadog monitors, cron failures, fail-queue alerts, StatusGator |
| #sentry-alerts | C05BQ2GP9FH | New and regressed Sentry issues |
| #systems-team-alerts | C076CHLECKU | Systems team alerts and the daily fail-queue report, where owners often reply |

Add any channel I name. Don't post in any of them.

### State

Keep the state in `<scratchpad>/oncall/`:

- `state.json`: `{"last_dm_ts": "<newest DM message you've handled>", "last_sweep_epoch": <unix seconds>}`
- `poll-prompt.md`: the current text of the scheduled poll message (below)
- `webhook`: the URL, mode 600

Tell me the full path of the directory once.

## The loop

### The poll chain

Run polls as a chain of one-shot `send_later` messages to this session. Each poll ends by scheduling the next one. Default to every 5 minutes. If I ask for faster, go down to 1 minute: then check my DM on every poll and sweep the channels every 5 minutes or so. Change the interval whenever I ask.

- Keep exactly one pending poll. Call `list_triggers` before you arm a new one, and cancel any extra.
- Name it `On-call poll (<N>-min chain)` so the backup and I can find it.
- Write the poll message so it stands on its own, because by the time a late poll fires, this skill and most of the conversation may be out of context. It carries the steps below, the channel and DM IDs, the paths, the posting rules, and the "Known context" list. Keep `poll-prompt.md` in sync with it.
- Use `send_later` and never `CronCreate` for the chain. A `CronCreate` job lives in the container and disappears when it restarts.

### The hourly backup

Scheduled tasks run at most hourly, so one can't be the main loop, but it can catch a broken chain. Create one with `create_trigger`: a cron at a jittered minute past every hour, bound to this session (no `create_new_session_on_fire`), `initiation: human_request`. It does three things:

1. Calls `list_triggers` and looks for a pending poll due within one interval plus a minute. A poll that is firing right now in the same batch also counts as healthy.
2. If there isn't one, re-arms the chain from `poll-prompt.md`, posts me one line saying the monitor had stopped and was restarted, and runs one full poll.
3. Otherwise does nothing.

When I change the interval, update the backup's prompt with `update_trigger` too.

### Each poll

Read what the poll message says, then:

1. **My DM.** Read top-level messages newer than `last_dm_ts`, and search for new thread replies (below). A request is a message from my user ID that I typed. Skip messages marked "Sent using" an app such as Cursor, and skip anything my bot posted. Answer each request through the webhook, in its thread if I wrote in a thread. Then set `last_dm_ts`.
2. **The channels**, when a sweep is due. Read each channel's top-level messages since `last_sweep_epoch`, in detailed format, because Datadog puts the alert body in attachments. Then run the thread search across all of them. Set `last_sweep_epoch` to now.
3. **Decide and notify** (triage below). Most polls send nothing.
4. **Re-arm** the next poll and write the state.

On a quiet poll, write one line in the session and nothing to Slack.

### Seeing thread replies

`slack_read_channel` only returns top-level messages posted after `oldest`, so a new reply under an old alert never shows up there. That gap is how I once missed that an owner had already replied, and then sent a wrong "declare a SEV-3" reminder. Every sweep also runs one `slack_search_public_and_private` with:

- `filters`: every channel as `in:<#ID>`, plus my DM, and `is:thread`. Repeating `in:` ORs them.
- `after`: the last check minus 120 seconds, because search indexing lags.
- `include_bots: true`, `sort: timestamp`.

Page through until you reach results older than that. For any reply that matters, open the whole thread with `slack_read_thread`. If a thread read comes back empty or odd, search for the person's messages in that channel and use the result's permalink, which carries the real `thread_ts`.

## Triage

Tell me about something only when it's new and needs action:

- an unowned production error with real user impact
- a deploy that ends failed or gets rolled back
- an alert that stays triggered well past its usual flap
- a question addressed to on-call, or to me, that I haven't answered yet
- an update on something I'm tracking: its owner posts, it recovers, or it gets worse

Before you call anything unowned, read its whole thread and search the channel for related threads. Something counts as owned when an engineer has said they're on it or mitigated it, when an owner has replied in a fail-queue report thread, or when Cursor has posted a draft-PR write-up on a low-impact Sentry error.

Skip these unless they turn into one of the cases above:

- successful deploys, and task failures in the middle of a Zuma rollout. They clear on their own, so only report a deploy that ends failed, rolls back, or still shows failed tasks once it's done.
- merge-queue test failures, PR notifications, and routine site config or experiment change notices
- Cursor's "No regression" follow-ups on site config changes
- StatusGator flapping for vendors. Mention a vendor outage only when our own Datadog or Sentry alerts fire for the features that use that vendor.
- "Too many slow queries on cluster/manny-prod". It flaps and usually recovers within 5 to 15 minutes, so report it only if it stays triggered for 20 minutes or more.
- alerts that already recovered

When someone tells on-call in advance about planned maintenance, note who owns it and when it runs. During the window, check that person's thread on every poll. Pass their updates on to me in a line or two, flag related alerts that last or show user impact, and send me a one-line all-clear when they say it's done.

### What a notification looks like

- Lead with the bold point, then two to four short bullets.
- Link every item with Slack mrkdwn, `<url|text>`. Link to the thread when there is one.
- Say who owns it, or that nobody does, and what you think I should do, which is often nothing.
- Separate what you saw from what you're guessing. Write "inferred from the code" or "not confirmed in the logs" when that's the case.
- Don't repeat something you already reported unless it got worse.

Close things out. When something you flagged gets resolved or recovers, reply in the thread of your original message with one line.

### Known context

Keep a short "Known context" list in the poll message and update it whenever you report something or the owner changes, so later polls don't report the same thing again. For each item, record who owns it, the thread ts, what I've already been told, and what would make it worth telling me again. Take items off once they're resolved.

## Talking it through with me

When I ask something in the DM, answer it there through the webhook, and investigate first:

- Check the facts in the primary source before you state them: the thread, the Datadog alert, the Sentry issue, the Buildkite log, or the code. Read the thread and the related fail-queue report before you say who owns something or what caused it. If you're guessing a cause, say so.
- Before you give me a command to run, read the script and work out its required flags. A missing flag once failed a Buildkite run-task.
- For "should this be an incident?", look up the Incident Severity Ratings page in Notion and compare: SEV levels are for degradation users see. Give a recommendation, not a menu.
- For history questions ("has this happened before?", "who usually picks this up?"), search Slack, Sentry, and git history, and cite what you found.
- Correct yourself in the DM as soon as you find you were wrong, and say what you missed and why.

You only read and report. Anything outward-facing (posting in a channel, commenting on a PR, claiming an alert, changing a config, rerunning a job, declaring an incident) is mine to do. Tell me how. If I ask you to do one of those in the DM, ask me to confirm in the Claude Code session first. The DM is a convenience, not an approval channel.

## Stopping

Stop at the end of my on-call week unless I say otherwise. Stop sooner if I tell you to. To stop, cancel the pending poll, delete the hourly backup with `delete_trigger`, post one line saying monitoring is off, and tell me in the session.
