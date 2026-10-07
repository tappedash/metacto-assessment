# Refine Needs Hub prototypes with ui-ux-pro-max + 3-Click rule

## Goal
Apply ui-ux-pro-max guidance to `prototypes/` and make every core task reachable in ≤3 clicks from the role's landing screen.

## Success criteria
- 3-click audit table (results/01-audit.md) shows every core task ≤3 clicks after changes.
- Skill rules applied: skip link, nav icon+label, no emoji/glyph icons, deep links + working browser back, undo for triage actions, empty state, required indicator, inline error, reduced motion, tabular numbers, one primary CTA per screen, 24px+ targets, 44px inputs on mobile.
- Brand identity unchanged (metacto.com palette, Barlow/Inter); product scope unchanged.

## Current context
Static HTML/CSS/JS prototypes (no framework). Spec: product_specs/mvp_spec_20261007-051740.md. Skill installed at .claude/skills/ui-ux-pro-max (commit 477bcb2).

## Constraints
- User: no automated tests for now — verification is a manual checklist only.
- Skill's --design-system output (glassmorphism, blue palette, Plus Jakarta) rejected: conflicts with required brand and earlier brief.
- No commit/push.

## Risk level
Low–medium: local prototype files only.

## Approval gates
None triggered (no deletion of user data, no publish, no commit).

## Mode
Workflow mode. No-delegation reason: changes are tightly coupled — one shared stylesheet and script plus five pages sharing the same components; parallel writers would conflict on shared files.

## Work packets
01 audit (3-click + skill rules) · 02 shared styles/app.js · 03 role pages · 04 manual verification checklist

## Eval contract
- Outcome: every core task ≤3 clicks; skill checklist items addressed.
- Shared surfaces: styles.css, app.js (used by all pages).
- Required checks: manual review of click paths and checklist (no automated tests per user).
- Blocking conditions: brand change, scope change, regression of confidentiality rules.
- Handoff evidence: audit table before/after in final-report.md.

## Integration policy
Parent session edits all files sequentially; shared files first, then pages.

## Verification plan
Manual checklist against audit table and skill pre-delivery checklist; automated checks skipped per user.

## Completion criteria
All packets done, final-report.md written, skipped checks stated.
