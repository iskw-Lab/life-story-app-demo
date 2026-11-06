# TOMONI ケースカンファレンス支援システム（デモ）

当事者参加型ケースカンファレンス（0回目 → 1回目 → 1.5回目 → 2回目 → 追跡）の循環を支える情報基盤の試作です。

- **デモ:** https://iskw-lab.github.io/life-story-app-demo/
- データは**架空の生育史**（シーズデータ）です。会議データはすべて模擬入力です。画面で付けた印や記録は、閲覧しているブラウザ内にだけ保存されます。

## 構成

| パス | 内容 |
|---|---|
| `prototype/` | デモ本体（HTML/CSS/JS、ビルド不要）。GitHub Pages で公開 |
| `scripts/build_seed.py` | `data/` の xlsx から `prototype/data/seed.js` を生成（`pip install openpyxl`） |
| `data/` | シーズデータ（架空） |
| `docs/requirements.md` | 要件定義書 |
| `docs/a11y-report.md` | アクセシビリティ確認レポート |
| `.claude/skills/` | 確認手順（WCAG 2.2 AA / ISO 9241-171、COGA） |

## ローカルで動かす

`prototype/index.html` をブラウザで開くだけで動きます。シードデータを作り直すとき:

```bash
python3 scripts/build_seed.py
```

## 開発の進め方

- `main` へ直接 push せず、ブランチを作って Pull Request で取り込みます。
- 画面を変えた PR では、`.claude/skills/a11y-compliance/scripts/axe_audit.sh` を実行し、`docs/a11y-report.md` を更新してください。
- `main` にマージすると、GitHub Actions がデモを自動で公開します。
