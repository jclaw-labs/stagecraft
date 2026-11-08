---
name: design-exploration
description: Explore and present design options for a screen or interaction on a Claude Design canvas built from the project's design system, then verify the pick in a real build and hand it off as an issue. Use whenever Jackson asks how a screen or interaction should look or behave, asks for UI mocks, options or a redesign, or when an issue's open question is a visible UI choice. Skip for copy-only tweaks, pure bug fixes, and behavior with no visible UI.
---

# Design exploration

How to take a question about a project's UI from "how should this work?" to an approved, buildable design. Jackson reviews visually, often from his phone, and decides between options. Your job is to make that decision easy, fast and accurate.

## Standard design resources

The skill finds everything it needs in standard places, so a project needs no file written for this skill. Jackson's projects share this layout:

| Resource | Standard place | Required |
|---|---|---|
| Design system source | `docs/design/system/`: `README.md`, `tokens.json`, `components/<Name>/README.md` (plus a `preview.html`), `assets/` | Yes |
| Design system artifact | A `claude.ai/artifact/…` link in `docs/design/system/README.md` or `docs/design/design-system.md` | Yes |
| Theme code | The files `tokens.json` lists under `meta.paths.tokens` | Yes |
| Component code | Each `components/<Name>/README.md`, which names the code that draws that component | Yes |
| Sync rules | A section of `docs/design/system/README.md` on keeping the system and the app in sync | Yes |
| Voice and copy | A "Voice and copy" section of `docs/design/system/README.md` | No |
| Design notes | `docs/design/design-system.md`: how to use the tokens in code, and the token checks to run | No |
| Preview mode | A `README.md` section with "preview" in its heading, saying how to run the app on sample data with no sign-in or network | No |
| Sample data | The fixture that preview mode loads | No |

### Discover before step 1

Look for each resource in its standard place, and if it's not there, search the repo for it by name (a `tokens.json`, a `Theme.swift` or `theme.ts`, a Tailwind config, a CSS file of custom properties, a Storybook, a fixtures folder). Then report what you found, in a short list at the top of your first message:

- **Required resource missing:** stop before designing. Say what's missing and propose creating it now: a design system made from the code with the **Design System** artifact type, saved to `docs/design/system/`. Designing without the system produces mocks that don't match the app. Continue only if Jackson says to.
- **Optional resource missing:** say so in one line, say what you'll do instead (for example, mock data written from realistic examples, or screenshots from a manual run of the app), and continue.
- **Found, but in an unusual place or shape** (a design system outside `docs/design/system/`, tokens with no `meta.paths`, component READMEs that don't name their code, a preview mode documented somewhere else): use it, name where it is, and recommend one of two fixes. Either move it to the standard place in that project, or add the new pattern to this table in local-config's copy of this skill if it's a reasonable convention other projects might share.

Read the design system README before designing.

## Rules that always apply

- **Show, don't describe.** No recommendation without mocks. Prose explains the options; it never replaces them.
- **2–3 real options, plus today.** Put the current screen first as a "Today" artboard, then options that differ in approach, not in polish. Recommend one, but keep showing the others until Jackson picks.
- **Every state.** For each option: default, after each action, undo or confirmation if any, empty, edge cases (long text, zero and many items, scrolled past a marker), and the moment between (a pressed control, an animation's start and end).
- **One link.** Send the canvas link, not a pile of screenshots. A thread holds at most 24 attachments. Videos are the exception (see Motion).
- **Accurate to the app.** Build only from the design system's tokens and components. If a mock needs something the system lacks, add it to the system first, marked *Proposed (issue #N)*, following the system's sync rules.
- **Plain copy.** UI text reads as sentences a person would say, held to the project's voice rules.
- **Nothing queues until Jackson says so.** File or update the issue while you iterate, but ask for it to be queued only on his explicit go-ahead.

## Tools

- Claude Design artifact types (Artifact tool, `action: "list"`, `scope: "types"`): **Design** for the canvas, **Design System** for the system. Follow each type's own instructions for file shapes.
- Anthropic's Design plugin, enabled on Jackson's account. Two of its skills are used, each for a specific reason:
  - `design-critique` (step 5). It forces a structured second look at each option: what draws the eye in the first two seconds, whether the goal is reachable, reading order, and consistency with the system. Building artboards doesn't make you step back like that. Use its framework; don't paste its report or emoji tables into the message. Summarize what changed because of it in a line.
  - `design-handoff` (step 8). Its spec template (tokens used, every state, edge cases, motion with duration and easing, accessibility notes) is the checklist that stops a worker from guessing. On a native platform, adapt it as the platform notes say.
  - `accessibility-review` audits against web WCAG (keyboard order, ARIA, focus traps). Use it for web projects; for native apps it's the wrong frame, and the platform's own checks in step 5 cover accessibility instead.
  - Not used: `ux-copy` is generic, and the project's voice rules are more specific. `design-system` documents components in its own format, but the Design System artifact type's instructions govern that system.

## Steps

0. **Check your tools first.** This skill needs Claude Design: the Artifact tool with the **Design** type available (`action: "list"`, `scope: "types"`). Without it (a Codex run, or a session with no Artifact tool), stop and say so to whoever asked (in a project, the coordinator), so a Claude session with Claude Design picks it up; don't fall back to describing designs in prose. Then check whether the Design plugin's `design-critique` and `design-handoff` skills are in your skill list (the name may carry a plugin prefix). If they're missing, apply the same checks by hand from the summaries above, and say in your message that you did.
1. **Frame the question.** One sentence for the decision, plus what's fixed (constraints, earlier decisions in the thread or issue). If anything is ambiguous, pick the likely reading and say which.
2. **Inventory the screen.** Find the views involved, starting from the code each component's README names, and list the states each can be in. Map each view to a design-system component. Add missing components to the system first.
3. **Build "Today".** Recreate the current screen on a new Design canvas at the platform's frame size (below) from the system's components, with realistic sample data from the project's fixtures. Check it against a screenshot of the current build (from preview mode, when there is one) and fix any drift before designing.
4. **Design the options.** One row of artboards per option, its states left to right, labeled with canvas titles. Make an artboard interactive (`is_interactive`) when the option is about a flow or gesture. Keep rationale and trade-offs in your message, not on the artboards.
5. **Check before sending.** Run `design-critique` on each option and fix what it finds. Then check the recommended option for accessibility: text contrast of at least 4.5:1 on every surface it can appear on, touch targets of at least 44 pt (or 24 CSS px for pointer-only web controls), an accessible label for every control and icon, and the layout at a large text size. On web, run `accessibility-review` too. Hold new copy to the project's voice rules.
6. **Present.** Message: the question in a line, the canvas link, each option in one or two sentences, your recommendation and why, and any open questions. Ask Jackson to comment on the canvas or reply in the thread.
7. **Verify the pick in the real app.** Once an option is chosen, build it as a throwaway prototype in the real app, run through preview mode when there is one, taking any lock its README section names. Never patch the checkout for this; work in a throwaway copy (a `git archive` export in your scratchpad) when the prototype needs code changes. Capture the states as screenshots and any motion as video. Fix gaps between the canvas and the real build, and update the canvas.
8. **Hand off.** Write the approved design into the issue: the decisions, every state, exact tokens, motion timings, copy, the canvas link and the reference screenshots or videos in the project library. Use `design-handoff`'s template, adapted to the platform. Mark new parts *Proposed (issue #N)* in the design system. Ask for the issue to be queued only when Jackson says it's ready.

## Platform notes

Canvas mocks are HTML. When the app isn't, these are the places where a web-style mock misleads.

### All platforms

- **Motion.** A canvas can't show the app's real animation honestly. Prototype motion in the real build, record it, and check timing frame by frame (ffmpeg at 60 fps) before showing it. Screen recorders often write frames only on change, so re-time to a constant frame rate with holds before and after, and loop it 2–3 times. State durations and curves in milliseconds; layout changes default to about 225 ms ease-in-out, with fades and moves happening together. Always respect reduced motion.
- **Real data.** Use realistic content and lengths from the project's sample data, including long names and titles, zero and many items, and expired or stale items.
- **Contexts.** Check new parts on every surface or theme they can appear on: light and dark, or the contexts the design system defines (such as a paper screen and dark on-ink chrome).

### iOS and other native mobile apps

- **Frames.** Use phone artboards at 390 × 844 pt, 1 pt = 1 CSS px. Leave the top 47 pt (status bar) and bottom 34 pt (home indicator) clear, and don't draw a fake status bar.
- **Dynamic Type.** Text scales. Include one artboard at a large accessibility size for any layout that could break (chips wrapping, a tab bar stacking, long titles). In the handoff, replace `design-handoff`'s responsive breakpoints with Dynamic Type sizes.
- **Touch, not hover.** There are no hover states. Show pressed states, long-press context menus (as a system menu over a dimmed screen with the item lifted), swipe actions, and pull to refresh as their own artboards. In the handoff, replace hover with press, long-press and swipe.
- **System UI.** Context menus, sheets, alerts, share sheets and keyboards are system components. Draw them to look like the platform's and don't restyle them with project tokens. Note in the handoff which parts are system-provided.
- **Icons.** Name the SF Symbol (or the platform's icon) for every icon in the handoff, such as `arrow.up` or `xmark`. On the canvas, draw a stroke SVG of matching size and weight.
- **Scroll and position.** Lists scroll under floating chrome. Show states that depend on scroll position (a marker offscreen, a top pill visible, back-to-top showing) as separate artboards. In SwiftUI, `LazyVStack` and `List` build rows only near the screen, so a state that depends on an offscreen row needs a scrolled artboard and a scrolled capture.
- **Simulator capture.** Record motion with `xcrun simctl io <udid> recordVideo`.
- **Haptics and sound.** These can't be mocked. List them in the handoff if the design uses any.

### Web

- **Frames.** Artboards at the project's breakpoints, at least one phone width (390 px) and one desktop width (1440 px).
- **Hover and focus.** Show hover, focus-visible and active states as their own artboards, and the keyboard path through any new flow.
- **Responsive.** Show how the layout changes at each breakpoint the project's theme code defines, including text wrapping at the narrowest.

## Done when

- Jackson has picked an option from mocks that matched the real app, and has seen every state and any motion.
- The issue holds the full handoff, the design system is updated (*Proposed* marks included), and Jackson has said it's ready to queue.
