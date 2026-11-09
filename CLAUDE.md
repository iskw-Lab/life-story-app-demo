# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Git remote: `git@github.com:iskw-Lab/life-story-app-demo.git`. Work on a branch and open a PR; do not push to `main` directly. Merging to `main` deploys `prototype/` to GitHub Pages (`.github/workflows/pages.yml`, https://www.iskwlab.jp/life-story-app-demo/). `doc/` (the source planning documents) is git-ignored and exists only locally.

The repository holds planning material, a data snapshot, the requirements, and a static prototype:

- `doc/…5カ年研究計画書（Ver.3）.docx`: the 5-year research plan for the **TOMONI study** (2026–2030). It is a joint project of 神奈川県立福祉機構, 東京大学先端研 and 静岡大学情報学部. The main research field is the 当事者参加型ケースカンファレンス held at 中井やまゆり園.
- `doc/ライフヒストリー支援.pptx`: the concept deck for the life-history support system this app will implement.
- `data/TOMONI_study_CaseConferenceSupportSystemDB20261101.xlsx`: a static backend extracted from an earlier single-file HTML prototype (`ライフヒストリー_5名模擬ケース会議_入力済み可視化システム.html`, which is not in this repo). Editing the Excel does not sync back to that HTML.

- `docs/requirements.md`: the requirements definition (MVP-focused) derived from the above. Treat it as the source of truth for scope, functional IDs (FR-x.y), design principles (P-1…P-9), and open issues (U-x). The top screen is a case-conference dashboard (F-0: home list → per-person dashboard that aggregates questions, reflections, practice results, and life story, with drill-down to raw records). The life-story UI is three linked views: V1 overview (3 layers 病気/生活/社会制度 with relation curves), V2 vertical-scroll detail, and V3 本人向け絵巻物.

The doc/data files are binary Office files. To inspect them, use `openpyxl` for the xlsx, or unzip the docx/pptx and read their XML.

## Prototype

- `python3 scripts/build_seed.py` regenerates `prototype/data/seed.js` from the xlsx (needs `openpyxl`). It also generates the *candidate* layer assignments (requirements 9.4), residence strip, and relation candidates (6.4); edit the rules there, not in the JS.
- Open `prototype/index.html` directly in a browser (no server/build). Hash routes: `#/` home, `#/p/P001` dashboard (F-0, A4 one-page summary; prints on one A4 landscape page), `#/p/P001/d/{questions,reflection,practice,awareness,health,next}[?at=<anchor>]` dashboard detail pages (F-0.6; `health` is F-15 身体と医療の経過), `#/p/P001/v1?sel=<sceneId>` V1 overview (F-3.1), `#/p/P001/v2?focus=<sceneId>` V2 detail (F-3.2), `#/p/P001/v3` 本人向け絵巻物 (F-3.5/F-10), `#/p/P001/meeting?step=<id>` meeting screen (F-7). V3 and the meeting screen live in `prototype/views.js` and plug into app.js through `window.TOMONI.route(...)`. V1↔V2 share view state (`st`: layers, question/theme highlight, brushed period); V2 jumps change the hash so browser back restores the previous card. Vanilla JS + SVG, no dependencies; marks/events/relation decisions persist only in `localStorage` (`tomoni_proto_v1`). Human corrections to scenes and relations made in V1 (FR-3.1.17–20; on the chart via drag/arrow keys when `st.v1Edit` is on, or via the summary forms) are overlays: seed values stay in each object's `.orig`, and `applyEdits()` re-applies `store.d.sceneEdits` / `relEdits` / `userRels` onto the shared `S.scenes` / `S.relations` objects, so V2, the drawer and the dashboard read the corrected values without extra wiring.
- Headless-Chrome screenshots of heavily scrolled V2 states can come out blank; check state via `--dump-dom` instead.

## Product concept (from the pptx)

The goal is to help support staff (支援者) understand the person (本人) more deeply, so that the person's QOL and well-being improve. **The AI never decides what the person feels or wants.** It produces *questions* that keep staff thinking, and staff confirm those with the person.

There are five features:
1. 暮らしの歩み: a timeline that lines up past experiences with current activities.
2. 気づきを促す: points out what has not been confirmed yet.
3. 希望と計画: compares the hopes the person has expressed with the support plan.
4. 計画と実践: compares the plan with the support actually given and the person's reactions.
5. 支援の傾向: shows differences between periods and between staff members.

The system generates three kinds of question:
1. 常に考える必要のある問い: questions that must always be considered, such as a gap between the person's hopes and actual practice.
2. 気づきを与える問い: questions that offer another viewpoint when the discussion leans toward one perspective.
3. 将来の可能性を考える問い: What-if questions about the future if current support continues.

Outputs must not steer toward a single "correct" interpretation, because diversity of interpretation is a core requirement.

The system is used in two settings: case conferences (all three question types) and daily practice (types 1 and 2).

Several things are still undecided: cloud (AWS) vs. on-prem at 秦野, permission to collect and transfer raw records to the Hamamatsu analysis environment, who may see full raw records vs. excerpts vs. IDs only, and the participant and recording conditions.

## Data model (xlsx)

The `テーブル関連` sheet defines the relationships. The ID chain is:

```
原記録(記録ID) ← 場面(場面ID, 原記録ID) ← 記述ユニット(記述ID, 場面ID)
                                         ← 意思表出 / 好き・苦手 / 支援試行 / 身体サイン / 解釈・仮説 (記述ID)
支援者マスタ(支援者ID) ← 記録関与 ;  見立て観点辞書(観点ID) ← 観点エビデンス
会議_基本情報(会議ID, 場面ID) ← 会議_参加者 / 会議_3つの問い / 会議_発言 / 会議_整理と実践 / 会議_What-if
```

ID formats include `C0101` (scene), `U0101_01` (description unit), `P001` (person), `S001` (staff), `D01` (viewpoint), and raw record IDs like `10-08`. Evidence columns (`根拠`) cite paragraph, record, and unit IDs, for example `P0162 / 01-01 / U0101_01`. Keep this traceability back to the raw record in anything you build.

## Invariants to preserve in any implementation

- **Raw vs. derived vs. mock data must stay distinguishable.** The 12 base sheets are structured data derived from raw records. Every `会議_*` sheet is fabricated demo input (5 virtual participants, 16 statements about scene C1008). Never present the meeting data as real.
- **Automatic extractions are candidates, not facts.** Classifications, staff attribution, and viewpoint evidence are mostly `未検証` / `要確認`. Hopes, causes, and support effects are never treated as confirmed. Adjacent sentences must not be read as cause and effect. 観点エビデンス counts do not measure staff skill.
- **Privacy:** life histories can identify a person even after names are replaced with IDs, for example through a rare job or a specific date. The plan calls for per-data-class storage and viewing rules, separate maintainer and researcher permissions, and view and edit audit logs. None of these exist yet. Treat any real data as 要配慮個人情報.
- The prototype also stored user edits in browser `localStorage`. That data is not part of the xlsx.

## Accessibility gates

- Every UI change must pass the `a11y-compliance` skill: WCAG 2.2 AA = ISO/IEC 40500:2025, plus ISO 9241-171:2025. Run `THEME=light .claude/skills/a11y-compliance/scripts/axe_audit.sh` and `THEME=dark …` (V2 needs `BUDGET=30000 TIMEOUT=200`), do the manual checklist, then update `docs/a11y-report.md`.
- 本人向け screens (V3, 様式E) must also follow the `coga-person-view` skill (W3C COGA *Making Content Usable*). Easy-read captions are supporter drafts until confirmed with the person.
- Colour tokens in `prototype/style.css` are contrast-checked: use `--muted` for small text (never `--mark-muted`), `--link` for links, and `--btn-primary` behind white text.
