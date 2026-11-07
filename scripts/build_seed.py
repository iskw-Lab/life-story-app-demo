"""Convert the seed xlsx into prototype/data/seed.js (window.SEED = {...}).

Layer assignments, life places and relations are generated here as *candidates*
(requirements 9.4 / 6.4); nothing produced by this script is a confirmed fact.

Usage: python3 scripts/build_seed.py
"""
import json
import re
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "data" / "TOMONI_study_CaseConferenceSupportSystemDB20261101.xlsx"
OUT = ROOT / "prototype" / "data" / "seed.js"


def rows(wb, name):
    it = wb[name].iter_rows(values_only=True)
    header = [str(h) for h in next(it)]
    return [dict(zip(header, r)) for r in it if any(c is not None for c in r)]


def s(v):
    return "" if v is None else str(v)


# ---- layer rules (requirements 9.4) -------------------------------------------
MEDICAL_RECORDER = re.compile(r"看護|医師|病院|小児科|歯科|眼科|専門外来|診療")
MEDICAL_WORDS = re.compile(r"受診|服薬|薬|診断|治療|排便|睡眠|眠|痛|むし歯|眼鏡|麻酔|発熱|噛まず|足首|腹")
INSTITUTION_RECORDER = re.compile(r"児童相談所|判定機関|判定")
INSTITUTION_WORDS = re.compile(
    r"療育手帳|手帳|判定|再判定|入所|短期入所|転居|退所|引継ぎ|感染対策|感染対応|身体拘束|進路|見学|体験利用|受入先|改修"
)
LIFE_KINDS = re.compile(r"家庭|連絡帳|育児メモ|支援記録|活動記録|面会|メモ|給食|文化祭|外出")
RESTRAINT = re.compile(r"身体拘束|押さえ|腕を持")
THEMES = {
    "車": re.compile(r"車"),
    "タオル": re.compile(r"タオル"),
    "写真・写真帳": re.compile(r"写真"),
    "パン": re.compile(r"パン"),
    "かご": re.compile(r"かご"),
    "枕カバー": re.compile(r"枕カバー"),
    "姉": re.compile(r"姉"),
    "音・音楽": re.compile(r"音楽|太鼓|楽器|耳をふさ"),
}


# ---- speaker of each quoted phrase 「…」 (本人／母／父／支援者／その他の家族／不明) ----
SUPPORTERS = r"(?:私|職員|支援員|担任|教員|看護師|相談員|医師|保育士|三浦|山口|田辺|吉井|西田|片岡|高橋|新井|河合|小野|森|佐伯|石井|岡田|中村|長谷川|藤井)"
QUOTE = re.compile(r"「([^」]*)(?:」|$)")


def quote_speakers(text, writer, prev_speaker=None):
    """Return [{text, speaker, basis}] for each 「…」 in a description unit.

    Rules are conservative: a quote is attributed to 本人 only when nothing in the sentence
    names another speaker and the verb after it is an utterance by the person (言う・叫ぶ・繰り返す).
    Anything not decided is 不明 (shown as 「引用文：発言者未確認」).
    """
    out = []
    for m in QUOTE.finditer(text):
        prefix = text[text.rfind("。", 0, m.start()) + 1:m.start()]
        suffix = text[m.end():m.end() + 12]
        speaker, basis = "不明", "発言者を特定する語がない"
        fam = re.search(r"(母|父|姉|祖父|祖母)(?:より|は|が|から|も)[^「」。]{0,10}$", prefix)
        sup = re.search(SUPPORTERS + r"(?:は|が|より|から|も)[^「」。]{0,10}$", prefix)
        if re.search(r"本人(?:は|が)", prefix):
            speaker, basis = "本人", "「本人は／が」"
        elif fam:
            w = fam.group(1)
            speaker, basis = (w if w in ("母", "父") else "その他の家族（" + w + "）"), f"「{fam.group(0)[:3]}…」"
        elif sup:
            speaker, basis = "支援者", f"「{sup.group(0)[:4]}…」"
        elif re.search(r"(母|父)に[^「」。]{0,6}$", prefix) and suffix.startswith("と言われ"):
            speaker, basis = prefix[re.search(r"(母|父)に", prefix).start()], "「〜に話すと…と言われた」"
        elif re.match(r"と(?:記録|記載|書|だけ書)", suffix) or re.search(r"(記録には|記録に|(?:日勤|夜勤)の)$", prefix):
            speaker, basis = "支援者", "記録の文言の引用"
        elif re.match(r"と(?:伝え|告げ|前に立つ|繰り返したが|促|声をかけ|説明|誘)", suffix):
            speaker, basis = "支援者", "関わる側の声かけ"
        elif re.match(r"とも(?:話|言)", suffix) and prev_speaker:
            speaker, basis = prev_speaker, "直前の発言者の続き"
        elif re.match(r"と(?:言う|言った|言い|叫|繰り返)", suffix) and not suffix.startswith("と言われ"):
            speaker, basis = "本人", "発話の動詞（主語なし）"
        if speaker == "不明" and writer in ("母", "父") and re.search(r"私(?:は|が)", prefix):
            speaker, basis = writer, "記録者本人（家族メモ）"
        out.append({"text": m.group(1), "speaker": speaker, "basis": basis})
    return out


def record_kind(header):
    if re.search(r"看護|診療|受診|治療|服薬|専門外来|眼科|歯科", header):
        return "medical"
    if re.search(r"判定|相談|会議録|引継ぎ|聞き取り|進路", header):
        return "consult"
    if re.search(r"家庭|メモ|連絡帳", header):
        return "family"
    return "support"


def main():
    wb = openpyxl.load_workbook(XLSX, read_only=True)

    raw = {r["記録ID"]: r for r in rows(wb, "原記録")}
    units = rows(wb, "記述ユニット")
    cand_specs = {
        "intent": ("意思表出", "意思ID", "本人の言葉・動作（原文）", "表出の種類（候補）"),
        "like": ("好き・苦手", "嗜好ID", "本人の反応（原文）", "方向（候補）"),
        "trial": ("支援試行", "試行ID", "支援・関わりの原文", "因果関係"),
        "body": ("身体サイン", "サインID", "身体状態・行動の原文", "領域（候補）"),
        "hypo": ("解釈・仮説", "解釈ID", "発言・解釈の原文", "区分（候補）"),
    }
    candidates = []
    for ctype, (sheet, idcol, textcol, kindcol) in cand_specs.items():
        for r in rows(wb, sheet):
            candidates.append({
                "id": s(r[idcol]), "type": ctype, "sceneId": s(r["場面ID"]), "unitId": s(r["記述ID"]),
                "text": s(r[textcol]), "kind": s(r[kindcol]),
                "status": s(r.get("確認状態") or r.get("検証状態")),
            })

    units_by_scene, cands_by_scene = {}, {}
    for u in units:
        units_by_scene.setdefault(s(u["場面ID"]), []).append(u)
    for c in candidates:
        cands_by_scene.setdefault(c["sceneId"], []).append(c)

    scenes = []
    for r in rows(wb, "場面"):
        sid = s(r["場面ID"])
        text = s(r["場面の原文"])
        header = s(r["記録者等"])
        us = units_by_scene.get(sid, [])
        cs = cands_by_scene.get(sid, [])
        tags = " ".join(s(u["自動タグ候補"]) for u in us)
        ctypes = {c["type"] for c in cs}

        layers, reasons = [], {}
        med = []
        if "身体" in tags:
            med.append("タグ「身体」")
        if "body" in ctypes:
            med.append("身体サイン候補")
        if MEDICAL_RECORDER.search(header):
            med.append("記録者・所属（医療）")
        m = MEDICAL_WORDS.search(text)
        if m:
            med.append(f"語句「{m.group(0)}」")
        if med:
            layers.append("illness"); reasons["illness"] = med
        life = []
        for t in ("意思", "好悪", "支援"):
            if t in tags:
                life.append(f"タグ「{t}」")
        if "intent" in ctypes:
            life.append("意思表出候補")
        if "like" in ctypes:
            life.append("好き・苦手候補")
        if "trial" in ctypes:
            life.append("支援試行候補")
        themes = [k for k, rx in THEMES.items() if rx.search(text)]
        if themes:
            life.append("本人らしさ（" + "・".join(themes) + "）")
        if LIFE_KINDS.search(header):
            life.append("記録の種類（生活）")
        if life:
            layers.append("life"); reasons["life"] = life
        inst = []
        if INSTITUTION_RECORDER.search(header):
            inst.append("記録者・所属（判定・相談）")
        for m in INSTITUTION_WORDS.finditer(text + header):
            w = f"語句「{m.group(0)}」"
            if w not in inst:
                inst.append(w)
        if inst:
            layers.append("institution"); reasons["institution"] = inst
        if not layers:
            layers, reasons = ["life"], {"life": ["既定"]}

        # undated recollections: place them at the recalled period and keep the span (FR-3.1.1)
        date, date_range, date_note = s(r["出来事年月日"])[:10], None, ""
        if not date:
            m = re.search(r"(\d{4})[～〜~-](\d{4})年の回想", s(r["場面・所属"]))
            raw_date = s(raw.get(s(r["原記録ID"]), {}).get("記録日"))[:10]
            if m:
                date_range = [f"{m.group(1)}-01-01", f"{m.group(2)}-12-31"]
                date = f"{m.group(2)}-01-01"
                date_note = f"回想（{m.group(1)}〜{m.group(2)}年ごろ）・聞き取り日 {raw_date}"
            else:
                date, date_note = raw_date, "出来事の日付不明（原記録日を仮置き）"

        kind = record_kind(header)
        if kind == "medical" and "illness" in layers:
            primary = "illness"
        elif "institution" in layers and (INSTITUTION_RECORDER.search(header) or re.search(
                r"手帳|判定|入所日|転居|身体拘束の記録|進路|引継ぎ|感染", header + text[:20])):
            primary = "institution"
        elif "life" in layers:
            primary = "life"
        else:
            primary = layers[0]

        scenes.append({
            "id": sid, "person": s(r["本人ID"]), "date": date, "dateRange": date_range,
            "certainty": date_note or s(r["時期の確度"]), "recordType": s(r["記録種別"]),
            "heading": s(r["場面・所属"]), "recorder": header, "rawId": s(r["原記録ID"]),
            "text": text, "status": s(r["検証状態"]), "kind": kind,
            "layers": layers, "primary": primary, "layerReasons": reasons,
            "themes": themes, "restraint": bool(RESTRAINT.search(text)),
            "personVoice": any("本人発話候補" in s(u["本人の直接発話"]) for u in us),
        })
    scenes.sort(key=lambda x: x["date"])
    by_id = {x["id"]: x for x in scenes}
    d = lambda sid: by_id[sid]["date"]

    unit_out = []
    last_speaker = {}
    for u in sorted(units, key=lambda x: (s(x["場面ID"]), x["順番"] or 0)):
        sid = s(u["場面ID"])
        header = by_id[sid]["recorder"] if sid in by_id else ""
        writer = "母" if re.search(r"／\s*母・", header) else "父" if re.search(r"／\s*父・", header) else ""
        qs = quote_speakers(s(u["記述原文"]), writer, last_speaker.get(sid))
        for q in qs:
            if q["speaker"] != "不明":
                last_speaker[sid] = q["speaker"]
        unit_out.append({
            "id": s(u["記述ID"]), "sceneId": sid, "order": u["順番"], "text": s(u["記述原文"]),
            "tags": s(u["自動タグ候補"]), "voice": s(u["本人の直接発話"]), "quote": s(u["記録中の引用"]),
            "obs": s(u["観察/解釈候補"]), "status": s(u["判定状態"]), "quotes": qs,
        })
    for sc_ in scenes:
        sc_["personVoice"] = any(q["speaker"] == "本人" for u in unit_out if u["sceneId"] == sc_["id"] for q in u["quotes"])

    # ---- life places (residence) – candidates derived from move-in records -------
    places = [
        {"name": "家庭", "start": "1981-01-01", "end": d("C0402"), "evidence": ["C0101", "C0402"]},
        {"name": "ひだまり学園", "start": d("C0402"), "end": d("C0605"), "evidence": ["C0402", "C0605"]},
        {"name": "あさひ生活園", "start": d("C0605"), "end": d("C0804"), "evidence": ["C0605", "C0804"]},
        {"name": "こもれび園", "start": d("C0804"), "end": "2026-12-31", "evidence": ["C0804"]},
    ]

    # ---- relations (6.4) – all candidates ----------------------------------------
    rel = []

    def chain(ids, rtype, desc, method, **extra):
        for a, b in zip(ids, ids[1:]):
            rel.append({"id": f"R{len(rel)+1:03d}", "type": rtype, "from": a, "to": b, "desc": desc,
                        "method": method, "status": "候補", "by": "規則" if method == "rule" else "試作の例（静岡大）",
                        "confirm": "本人未確認", **extra})

    chain(["C0204", "C0304", "C0405", "C0504", "C0701"], "same_system",
          "療育手帳の判定・再判定の経過（A2→A2→A2→A1→成人期判定）", "rule")
    chain(["C0601", "C0602", "C0603", "C0604", "C0605"], "transition",
          "ひだまり学園からあさひ生活園への移行（進路相談・見学・体験・引継ぎ・入所）", "rule")
    chain(["C0801", "C0802", "C0803", "C0804"], "transition",
          "あさひ生活園からこもれび園への転居（相談・見学・転居日）", "rule")
    chain(["C0804", "C0807"], "overlap", "転居の時期と、食事時に右側で噛まない記録が重なる", "rule")
    for theme, rx in THEMES.items():
        ids = [x["id"] for x in scenes if theme in x["themes"]]
        chain(ids, "theme", f"同じもの・人・テーマ：{theme}", "rule", theme=theme)
    chain(["C0901", "C0902"], "trigger",
          "歯科治療の後に、食事中に頬を押すことが減った記録（支援者の見方・因果ではない）", "example")
    chain(["C0204", "C0307"], "institutional",
          "療育手帳の判定があったことで、通園の相談や短期入所を利用できた可能性", "example",
          direction="enable", system="療育手帳")
    chain(["C1001", "C1003"], "institutional",
          "感染対策の規則のため、外出を見合わせ、約2週間の別室生活となり棚を移せなかった", "example",
          direction="constrain", system="感染対策")
    chain(["C0801", "C0804"], "institutional",
          "施設の改修と支援体制のため、転居という対応になった可能性", "example",
          direction="constrain", system="施設基準・支援体制")

    supporters = [{"id": s(r["支援者ID"]), "name": s(r["氏名・呼称"]), "role": s(r["役割"]),
                   "org": s(r["所属・関係"]), "category": s(r["支援者種別"])} for r in rows(wb, "支援者マスタ")]
    involvement = [{"supporterId": s(r["支援者ID"]), "rawId": s(r["記録ID"]), "sceneId": s(r["場面ID"]),
                    "attribution": s(r["帰属区分"])} for r in rows(wb, "記録関与")]
    viewpoints = [{"id": s(r["観点ID"]), "name": s(r["観点名"]), "definition": s(r["操作的定義"]),
                   "limit": s(r["解釈上の限界"]), "question": s(r["省察質問"])} for r in rows(wb, "見立て観点辞書")]
    evidence = [{"id": s(r["候補ID"]), "supporterId": s(r["支援者ID"]), "sceneId": s(r["場面ID"]),
                 "unitId": s(r["記述ID"]), "viewpoint": s(r["観点ID"])} for r in rows(wb, "観点エビデンス")]

    meeting = {
        "info": rows(wb, "会議_基本情報")[0],
        "participants": rows(wb, "会議_参加者"),
        "questions": rows(wb, "会議_3つの問い"),
        "statements": rows(wb, "会議_発言"),
        "summary": rows(wb, "会議_整理と実践"),
        "whatif": rows(wb, "会議_What-if"),
        "settings": {r["設定ID"]: s(r["値"]) for r in rows(wb, "会議_画面設定")},
    }

    seed = {
        "builtFrom": XLSX.name,
        "persons": [{"id": "P001", "birthYear": 1981, "note": "架空の生育史（シーズデータ）"}],
        "scenes": scenes, "units": unit_out, "candidates": candidates,
        "raw": [{"id": k, "date": s(v["記録日"])[:10], "heading": s(v["記録見出し"]),
                 "recorder": s(v["所属・記録者等"]), "text": s(v["原記録全文"]),
                 "recall": s(v["回想・聞き取り候補"])} for k, v in raw.items()],
        "places": places, "relations": rel, "supporters": supporters, "involvement": involvement,
        "viewpoints": viewpoints, "evidence": evidence, "meeting": meeting,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("window.SEED = " + json.dumps(seed, ensure_ascii=False, default=str) + ";\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(scenes)} scenes, {len(unit_out)} units, "
          f"{len(candidates)} candidates, {len(rel)} relations")


if __name__ == "__main__":
    main()
