---
name: coga-person-view
description: Design and review rules for screens used by or with the 本人 (person with intellectual disability/autism) — V3 本人向け絵巻物, 様式E 振り返り, any easy-read output — based on W3C "Making Content Usable for People with Cognitive and Learning Disabilities" (COGA, https://www.w3.org/TR/coga-usable/). Use when building or changing 本人向け screens, writing やさしい日本語 text, or reviewing them; run together with the a11y-compliance skill.
---

# 本人向け画面のデザイン（COGA: Making Content Usable）

Source: W3C *Making Content Usable for People with Cognitive and Learning Disabilities* (https://www.w3.org/TR/coga-usable/). It has 8 objectives with design patterns (sections 4.2–4.9).

This skill turns those patterns into rules for this project. The rules sit on top of WCAG 2.2 AA (a11y-compliance), not in place of it. COGA patterns are **not pass/fail criteria**. Treat them as design requirements, and validate them with the person and peer supporters (requirements FR-3.5, FR-10.7, U-11, U-13).

## Project constraints that always apply on 本人向け screens
- **The person uses the app themself.** Design so the person can operate every step on their own. A supporter's help supports the person's own operation and is never assumed to replace it: do not design "proxy input" (代理入力) flows or labels. When help is given, record who helped and the method the person used.
- **Shown content:** only items the person agreed to show (掲載意思). No AI output, candidates, supporter interpretations, full raw records, or restraint records by default (FR-3.5.2).
- **Not consent:** a reaction is never treated as consent to a trial or to recording (FR-10.5).
- **No response is allowed:** 「いまは みない／こたえない」 is always available. Silence is never turned into a negative answer (P-4, FR-10.6).
- **Stopping:** the person can stop at any time. Stopping causes no loss and no reproach (P-5).
- **Helping is recorded:** when the person receives help, the helper and the method the person used are recorded (FR-3.7.2).

## Design rules by COGA objective

| COGA objective (patterns) | Rule for this app |
|---|---|
| **1 Understand what things are and how to use them** (4.2.1–4.2.7) | One clear title per screen (「わたしの あゆみ」). Same layout and button positions on every screen. Show where you are (「3 / 8」 plus a highlighted position on the scroll). Buttons look like buttons and always pair an icon with a word. Use familiar, literal icons only |
| **2 Find what they need** (4.3.1–4.3.4) | Few choices. The main action is big and first. No hidden menus. Prefer one item per view, with an overview strip for orientation |
| **3 Clear and understandable content** (4.4.1–4.4.13) | Use やさしい日本語: short sentences of about 15–25 characters, one idea per sentence, everyday words, literal language, no double negatives, no 「〜ないことはない」. Add ふりがな (`<ruby>`) to every kanji, with an option to turn it off. Use generous white space. Prefer pictures and photos to numbers, e.g. 「3さいの ころ」 instead of 「1984年」. Keep ages approximate and human (「ちいさい ころ」) |
| **4 Avoid mistakes and know how to correct them** (4.5.1–4.5.12) | Nothing moves unexpectedly (no auto-advance or carousel). Every reaction can be undone (「とりけす」). Give immediate, calm feedback in words (「『すき』を つけました」) that stays until the next action, with no timeout. Use visible labels. There is no free-text requirement |
| **5 Help users focus** (4.6.1–4.6.4) | No pop-ups or interruptions. Use the shortest path: open → see → react → next. Hide supporter-only tools in a clearly separated 「てつだう ひと へ」 area. Say before starting how many items there are and that they can stop anytime |
| **6 Processes do not rely on memory** (4.7.1–4.7.5) | No login or password for the person (the session is opened by the supporter). Never ask the person to remember earlier screens: show the picture again when asking. No calculations |
| **7 Help and support** (4.8.1–4.8.7) | A 「てつだって」 button is always in the same place and names the human helper. Explain what each choice does before it happens (「『いまは みない』で、ここで おわります。また みられます」) |
| **8 Adaptation and personalization** (4.9.1–4.9.4) | Settings for もじの おおきさ (large/extra large), ふりがな on/off and よみあげ (speech synthesis, ja-JP, stoppable). Respect `prefers-reduced-motion` and the colour scheme. Remember settings on the device |

## Concrete UI requirements (checklist)
- [ ] Targets ≥ 44×44 CSS px (≥ 64 px for the main reactions), with at least 8 px between them.
- [ ] Body text ≥ 20px (large setting ≥ 26px), line-height ≥ 1.7. No justified text. No italics.
- [ ] Every icon/emoji is `aria-hidden="true"` and always has a visible text label next to it.
- [ ] Reaction buttons are toggles with `aria-pressed`. The selected state shows a check mark and the word 「えらんだ」, not only colour.
- [ ] Reactions: 「すき」「たいせつ」「ちがう」「わからない」「いまは みない」. Each one says what it does in plain words.
- [ ] Feedback goes in a `role="status"` region and never auto-hides.
- [ ] 「やめる」 is always visible in the same place. It goes to a calm end screen (「おわりました。また いつでも みられます」) with no data loss.
- [ ] Read-aloud reads only the visible easy text, can be stopped, and does not start automatically.
- [ ] No timers, countdowns, animations or auto-scroll (or honour `prefers-reduced-motion`).
- [ ] One screen shows only the scene, up to 4 reactions and previous/next. Settings, help, overview and word entry open as toggle panels from fixed buttons.
- [ ] Words can be added without typing: tappable word cards, and voice input where the device supports it. Free text is optional.
- [ ] Guard against accidental double taps: a second tap within about 0.8 s must not undo a choice just made.
- [ ] 「いまは みない」 skips only the current item (recorded as unanswered) and moves on. 「やめる」 is the only way to end.
- [ ] The overview (「ぜんぶ みる」) shows the person's own past choices on each item, so they don't have to remember them.
- [ ] Optional 「いつも きく」 voice mode, chosen by the person (default off): reads each item and each result. Arrow keys move between items.
- [ ] Helper area: who helped and how (ゆびさし・ことば・カード・みぶり・その他), recorded separately from the person's own reaction.
- [ ] Easy-read captions are drafts written by supporters. Mark them 「下書き（ほんにんと たしかめる）」 in the helper area until confirmed.

## Review procedure
1. Walk through the screen as the person would, using touch only, then keyboard only, then read-aloud only.
2. Check every row of the table and the checklist. Record the result as Pass / Needs work / Validate with person.
3. Run `a11y-compliance` (axe + WCAG manual pass) on the same screen.
4. Write the result into the 本人向け section of `docs/a11y-report.md`. List what must be co-designed with the person and peers (U-11, U-13). Do not mark these as "done" on our own judgement.
