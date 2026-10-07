# 01 Audit — 3-Click rule (clicks counted from the role's landing screen; typing excluded)

| Role | Task | Before | Issue | After (planned) |
|---|---|---|---|---|
| Client | Submit + support existing Need | 3 (Continue → Find → Yes) | OK but AI follow-up is a separate step | 2 (Find similar needs → Yes): AI follow-up inline on step 1 |
| Client | Support a Need found in Discover | ∞ | No support action on Need page | 3 (Discover → Need → Support) |
| Client | Check progress of my Need | 2 | OK | 2 |
| PM | Resolve a triage item | 1 | No undo / no resolved state | 1 + Undo |
| PM | Open suggested Need from triage | ∞ | Need name is plain text | 1 (link) |
| PM | Decide on a Need | 3 (Needs → Need → Save) | OK | 3 |
| PM | Approve drafted update | 2 | OK | 2 |
| Engineer | Log feedback + attach to match | 4 (Log → Continue → Find → Yes) | Violates rule | 3 (Log → Find → Yes): follow-up inline |
| Engineer | Add tech notes to ticket | 2 | OK | 2 |
| Engineer | Move delivery status | 1 | OK | 1 |
| Engineer | Forward approved update | 2 | OK | 2 |
| Admin | Staff an engineer | 3 (Staffing → tick → Save) | Extra Save | 2 (autosave on tick) |
| Admin | Add / edit strategic goal | 2 | OK | 2 |

## Skill-rule findings (ui-ux-pro-max quick-reference)
- §1 skip-links missing; §1 web-target-size: default checkboxes ~13px.
- §4 no-emoji-icons: unicode glyphs (✦ ○ ◐ ◑ ● ←) used as icons → CSS/SVG shapes.
- §4 primary-action: several orange CTAs per screen (triage items, tickets) → one primary per screen.
- §6 number-tabular missing on data columns.
- §7 reduced-motion not respected.
- §8 required-indicators, undo-support, empty-states missing; toast 2.6s (<3s).
- §9 nav-label-icon: nav is text-only; deep-linking/back-behavior: views don't update URL, browser back leaves the page.
- Rejected: --design-system output (glassmorphism, blue palette, Plus Jakarta Sans) — conflicts with brand.
