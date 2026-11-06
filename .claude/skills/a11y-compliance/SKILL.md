---
name: a11y-compliance
description: Check this app's UI (prototype/ and any future front-end) for conformance with WCAG 2.2 Level AA (= ISO/IEC 40500:2025) and ISO 9241-171:2025 (software accessibility), plus the project's own design principles. Use whenever a screen is added or changed, before reporting UI work as done, or when asked to audit/check accessibility, アクセシビリティ, WCAG, ISO 40500, ISO 9241-171. For 本人向け screens also apply the coga-person-view skill.
---

# Accessibility compliance check (WCAG 2.2 AA / ISO/IEC 40500:2025 / ISO 9241-171:2025)

Target standards (what the user asked us to conform to):

| Standard | What it is | How we check it |
|---|---|---|
| WCAG 2.2 — https://www.w3.org/TR/WCAG22/ | W3C Recommendation | Level **A + AA** success criteria — `references/wcag22-aa.md` |
| ISO/IEC 40500:2025 — https://www.iso.org/standard/91029.html | WCAG 2.2 published as an ISO/IEC standard (identical text) | Satisfied by the WCAG 2.2 AA check; cite both in reports |
| ISO 9241-171:2025 — https://www.iso.org/standard/86308.html | Ergonomics of human-system interaction — guidance on software accessibility | Checklist in `references/iso9241-171.md`. The standard is paywalled: the checklist follows its published structure; mark any finding that depends on exact clause wording as「要原文確認」 |

AA is the conformance target. AAA criteria are recommended for 本人向け screens (see coga-person-view) but are not pass/fail gates.

## Procedure — do these in order

1. **Scope.** List every route/screen touched (prototype routes: `#/`, `#/p/P001`, `#/p/P001/d/{questions,reflection,practice,awareness,next}`, `#/p/P001/v1`, `#/p/P001/v2`, `#/p/P001/v3`, `#/p/P001/meeting`; plus the dashboard's A4 print layout) and every state that matters (drawer open, card expanded, form error, dark mode, 200% zoom, 320 CSS px width).
2. **Automated pass (axe-core, WCAG 2.2 A/AA tags).** Run from the repo root:
   ```bash
   .claude/skills/a11y-compliance/scripts/axe_audit.sh            # all prototype routes
   .claude/skills/a11y-compliance/scripts/axe_audit.sh '#/p/P001/v3'  # one route
   ```
   It loads each route in headless Chrome with axe-core from cdnjs and prints one line per violation (`route | rule | impact | count | WCAG refs | help`). Zero violations ≠ conformance: axe covers roughly a third of the criteria.
3. **Manual pass against `references/wcag22-aa.md`.** Go criterion by criterion. Read the code, do not guess. The criteria that automation misses and this app is most likely to fail are marked ★ in the checklist (keyboard access to SVG charts, focus order/visibility in the drawer, hover tooltips 1.4.13, dragging alternatives 2.5.7, target size 2.5.8, status messages 4.1.3, reflow 1.4.10, non-text contrast 1.4.11 for chart marks).
4. **ISO 9241-171 pass** with `references/iso9241-171.md` (user preferences, keyboard/focus, pointer alternatives, visual/audio output, help, compatibility with assistive technology).
5. **Project principles pass.** The requirement doc's P-1…P-9 have accessibility consequences. In particular: AI/candidate/mock status must never be conveyed by colour alone (1.4.1 + P-8). The 本人's expression must be distinguishable from others' interpretation by text, not only by style (1.3.1 + P-2). Stop/中止 must be reachable by keyboard in one step (P-5).
6. **Contrast is computed, not eyeballed.** For text use 4.5:1 (3:1 for ≥24px or ≥19px bold). For chart marks, focus rings and control borders use 3:1 against adjacent colours (1.4.11). Check both light and dark tokens in `prototype/style.css`. When chart colours change, also run the dataviz palette validator.
7. **Report** (format below), then **fix** everything rated Fail at A/AA unless the user decides otherwise, and re-run steps 2–6 for the touched screens.

## Report format

Write the report to `docs/a11y-report.md` (overwrite; keep a dated history table at the top). Use one row per finding:

| ID | Screen / state | Criterion (WCAG 2.2 / ISO 9241-171 clause) | Level | Result (Pass / Fail / N/A / 要原文確認) | Evidence (file:line or axe rule) | Fix |

Then add a summary per screen with counts of Fail at A and AA. List the criteria marked N/A with a one-line reason (e.g. 1.2.x: no media). Finally, add a "Known limitations" section for items you accepted, with a reason.

Do not claim "WCAG 2.2 AA 準拠" in UI text or docs unless every A/AA criterion is Pass or N/A for every screen in scope. Otherwise write 「部分的に準拠（未達項目は a11y-report 参照）」.

## Rules of thumb for this codebase

- SVG charts (V1, minis): each interactive mark is `role="button"` (or a link), has `tabindex="0"`, an `aria-label` with date, layers and short text, and activates on Enter **and** Space. Provide a non-chart equivalent: V2 or a table is the text alternative for V1. Charts get `role="img"` plus a summary only when they are not interactive.
- Any hover-only information (tooltips) must also appear on keyboard focus. It must be dismissible with Esc and stay visible while hovered (1.4.13). Everything inside it must also be reachable without hover (the drawer/V2).
- Every drag interaction needs a click/keyboard alternative (2.5.7): the V1 period brush → year inputs/buttons, and the mini-overview drag → click.
- Targets must be ≥ 24×24 CSS px (2.5.8). Use ≥ 44×44 on 本人向け and tablet-first screens.
- Opening the drawer moves focus into it. Esc closes it. Focus then returns to the trigger. While it is open, nothing focused may be hidden behind it (2.4.11).
- Saving, adding or failing an action announces itself through the shared `aria-live` status region (4.1.3). Do not use alert()-like toasts that time out (2.2.1).
- Each route sets a unique `document.title` and has exactly one `<h1>` (2.4.2, 2.4.6). `<html lang="ja">` is set. Mark text in other languages with `lang`.
- Never encode meaning by colour alone. Layer colour is always paired with a text label or shape; candidate vs adopted is shown by both line style and a text label in tooltips/lists.
