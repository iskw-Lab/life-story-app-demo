/* V3 本人向け絵巻物 (F-3.5, F-10 / skill: coga-person-view) and 会議画面 (F-7).
 * Uses window.TOMONI exported by app.js. Browser-local state only.
 */
(() => {
  "use strict";
  const T = window.TOMONI;
  const { S, M, PID, store, esc, fmtDate, $ } = T;

  // ---------- overlay meeting edits saved in this browser onto the in-memory seed ----------
  store.d.meeting ||= { statements: [], summary: {}, whatif: {}, compare: {}, log: [] };
  store.d.plans ||= [];
  store.d.consents ||= [];
  store.d.personReactions ||= {};
  store.d.personWords ||= {};
  store.d.personSkips ||= [];
  store.d.v3 ||= { size: "l", ruby: true, helper: "", method: "" };
  const MT = store.d.meeting;
  for (const st of MT.statements) M.statements.push(st);
  for (const [k, v] of Object.entries(MT.summary)) { const it = M.summary.find((x) => x["項目ID"] === k); if (it) it["内容"] = v; }
  for (const [k, v] of Object.entries(MT.whatif)) { const it = M.whatif.find((x) => x["シナリオID"] === k); if (it) it["内容"] = v; }

  // =====================================================================
  // V3 本人向け絵巻物
  // Only items the person agreed to show (FR-3.5.2). In this prototype the list below stands in for
  // "items chosen with the person"; the easy-read captions are supporter drafts to be confirmed.
  // {漢字|よみ} marks ruby.
  // =====================================================================
  const V3_ITEMS = [
    { id: "C0102", icon: "🚗", word: "{車|くるま}", text: "はいたつの {車|くるま}を みて、「ぶー」と いった。" },
    { id: "C0203", icon: "👴", word: "せんたくばさみ", text: "おじいちゃんと、せんたくばさみを {色|いろ}ごとに わけた。" },
    { id: "C0407", icon: "🧺", word: "タオル", text: "タオルを たたんで、はこに いれた。わらった。" },
    { id: "C0503", icon: "⚽", word: "ボール", text: "ねえさんと ボールを ころがした。こえを だして わらった。" },
    { id: "C0703", icon: "🎵", word: "{音楽|おんがく}", text: "{音楽|おんがく}を きいて、かたを ゆらした。" },
    { id: "C0707", icon: "🍞", word: "パン", text: "パンやさんで、かぞくの パンも えらんだ。" },
    { id: "C0904", icon: "📷", word: "{写真|しゃしん}ちょう", text: "ねえさんと、ちいさい {写真|しゃしん}ちょうを かった。" },
    { id: "C0908", icon: "🍞", word: "パン", text: "ねえさんと ちがう パンを えらんだ。ならんで {写真|しゃしん}を とった。" },
    { id: "C1006", icon: "🎁", word: "おみやげ", text: "おとうさんに、パンの ふくろを わたした。" },
  ];
  const PLACE_EASY = { "家庭": "いえ", "ひだまり学園": "ひだまりがくえん", "あさひ生活園": "あさひ せいかつえん", "こもれび園": "こもれびえん" };
  const REACTIONS = [
    { v: "すき", icon: "😊", help: "すきな ことに しるしを つけます" },
    { v: "ちがう", icon: "✋", help: "ちがう ときに おします" },
    { v: "わからない", icon: "❓", help: "わからない ままで だいじょうぶ" },
  ];
  // word cards: add words without typing (COGA 4.5.4 / 4.7.5)
  const WORD_CARDS = [
    { w: "たのしい", icon: "😄" }, { w: "うれしい", icon: "😊" }, { w: "すき", icon: "💗" },
    { w: "いや", icon: "😣" }, { w: "こわい", icon: "😨" }, { w: "また したい", icon: "🔁" }, { w: "もう いい", icon: "🙅" },
  ];
  const HELPERS = ["", "由紀（姉）", "西田（支援員）", "片岡（支援員）", "高橋（看護師）", "新井（工房職員）", "ピアサポーター"];
  const METHODS = ["", "ゆびさし", "ことば", "カード", "みぶり", "その他"];
  store.d.v3.voice ||= "tap"; // "tap" = read only when pressed, "auto" = read each picture and each result

  const v3 = { i: 0, screen: "start", panel: "", lastSet: null }; // screen: start|item|end ; panel: ""|settings|all|words|help
  const rubyHtml = (str) => esc(str).replace(/\{([^|}]+)\|([^}]+)\}/g, (_, k, r) => (store.d.v3.ruby ? `<ruby>${k}<rt>${r}</rt></ruby>` : k));
  const plain = (str) => str.replace(/\{([^|}]+)\|([^}]+)\}/g, "$2");
  const placeOf = (date) => { const p = S.places.find((x) => date >= x.start && date < x.end); return p ? PLACE_EASY[p.name] || p.name : ""; };
  const ageOf = (date) => T.yearOf(date) - T.birthYear;

  // ---- voice: read aloud (never starts unless the person chose it), voice input when available ----
  let speaking = false;
  const canSpeak = "speechSynthesis" in window;
  const Recog = window.SpeechRecognition || window.webkitSpeechRecognition;
  function say(text, { toggle = false } = {}) {
    if (!canSpeak) return;
    if (toggle && speaking) { speechSynthesis.cancel(); speaking = false; updateSpeakBtn(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP"; u.rate = 0.85;
    u.onend = u.onerror = () => { speaking = false; updateSpeakBtn(); };
    speaking = true; speechSynthesis.speak(u); updateSpeakBtn();
  }
  function stopSpeech() { if (canSpeak && speaking) { speechSynthesis.cancel(); speaking = false; } }
  function updateSpeakBtn() {
    const b = document.getElementById("v3speak");
    if (!b) return;
    b.setAttribute("aria-pressed", String(speaking));
    b.querySelector(".lbl").textContent = speaking ? "とめる" : "きく";
  }
  const itemSpeech = (it) => `${plain(it.word)}。${ageOf(T.sceneById[it.id].date)}さいの ころ。${plain(it.text)}`;

  // ---- state changes (person's own operation first; help is recorded, never assumed) ----
  const helpInfo = () => ({ helper: store.d.v3.helper, method: store.d.v3.method });
  function setReaction(id, value) {
    const cur = store.d.personReactions[id];
    const now = Date.now();
    // guard against an accidental double tap undoing a choice just made (COGA 4.5)
    if (cur && cur.value === value && v3.lastSet && v3.lastSet.id === id && v3.lastSet.v === value && now - v3.lastSet.t < 800) return `「${value}」を えらんで います`;
    if (cur && cur.value === value) { delete store.d.personReactions[id]; store.save(); v3.lastSet = null; return `「${value}」を けしました`; }
    store.d.personReactions[id] = { value, at: new Date().toISOString(), ...helpInfo() };
    store.save(); v3.lastSet = { id, v: value, t: now };
    return `「${value}」を えらびました`;
  }
  function toggleImportant(id) {
    const ms = (store.d.marks[id] ||= []);
    const i = ms.findIndex((m) => m.role === "本人");
    const now = Date.now();
    if (i >= 0 && v3.lastSet && v3.lastSet.id === id && v3.lastSet.v === "たいせつ" && now - v3.lastSet.t < 800) return "「たいせつ」を えらんで います";
    if (i >= 0) { ms.splice(i, 1); store.save(); v3.lastSet = null; return "「たいせつ」を けしました"; }
    ms.push({ role: "本人", at: new Date().toISOString(), ...helpInfo() });
    store.save(); v3.lastSet = { id, v: "たいせつ", t: now };
    return "「たいせつ」を えらびました";
  }
  function addWord(id, text, how) {
    (store.d.personWords[id] ||= []).push({ text, how, at: new Date().toISOString(), ...helpInfo() });
    store.save();
    return `「${text}」を たしました`;
  }

  function renderV3(params = {}, _keep, focusSel) {
    const app = T.app();
    T.crumbs().innerHTML = "";
    const set = store.d.v3;
    document.body.dataset.v3size = set.size;
    if (params.item) { const k = V3_ITEMS.findIndex((x) => x.id === params.item); if (k >= 0) { v3.i = k; v3.screen = "item"; } }
    const n = V3_ITEMS.length;
    const it = V3_ITEMS[v3.i];
    const s = T.sceneById[it.id];
    const fb = v3.feedback || "";
    const pressed = (b) => `aria-pressed="${b}"`;
    const chosen = (b) => (b ? '<span class="v3-chosen">えらんだ</span>' : "");

    // fixed top bar: same buttons, same place, on every screen (COGA 1, 7)
    const topbar = `
      <div class="v3-bar" role="navigation" aria-label="えまきもの の そうさ">
        <span class="v3-title-small">わたしの あゆみ</span>
        <span style="flex:1"></span>
        <button class="v3-btn" data-panel="settings" aria-expanded="${v3.panel === "settings"}"><span aria-hidden="true">⚙️</span> みかた</button>
        <button class="v3-btn" data-panel="help" aria-expanded="${v3.panel === "help"}"><span aria-hidden="true">🙋</span> てつだって</button>
        <button class="v3-btn" id="v3quit"><span aria-hidden="true">🚪</span> やめる</button>
      </div>`;
    const panels = {
      help: `<div class="v3-panel" role="region" aria-label="てつだって">
          <p>こまったら、そばの ひとに 「てつだって」と いってね。${set.helper ? `<br>きょう いっしょに いる ひと：${esc(set.helper)}` : ""}</p>
          <p>えらばなくても だいじょうぶ。「やめる」で いつでも おわれます。</p>
          <button class="v3-btn" data-panel="">とじる</button></div>`,
      settings: `<div class="v3-panel" role="region" aria-label="みかた を かえる">
          <div class="v3-row"><span class="v3-label">もじ</span>
            <button class="v3-btn small" data-size="l" ${pressed(set.size === "l")}>おおきい</button>
            <button class="v3-btn small" data-size="xl" ${pressed(set.size === "xl")}>もっと おおきい</button></div>
          <div class="v3-row"><span class="v3-label">ふりがな</span>
            <button class="v3-btn small" data-ruby="1" ${pressed(set.ruby)}>あり</button>
            <button class="v3-btn small" data-ruby="0" ${pressed(!set.ruby)}>なし</button></div>
          ${canSpeak ? `<div class="v3-row"><span class="v3-label">こえ</span>
            <button class="v3-btn small" data-voice="auto" ${pressed(set.voice === "auto")}>いつも きく</button>
            <button class="v3-btn small" data-voice="tap" ${pressed(set.voice === "tap")}>おしたときだけ</button></div>` : ""}
          <button class="v3-btn" data-panel="">とじる</button></div>`,
    };
    const openPanel = panels[v3.panel] || "";

    let body = "";
    if (v3.screen === "start") {
      body = `
        <section class="v3-card v3-center">
          <h1 class="v3-h1" tabindex="-1">わたしの あゆみ</h1>
          <div class="v3-preview" aria-hidden="true">${V3_ITEMS.map((x) => `<span>${x.icon}</span>`).join("")}</div>
          <p>${rubyHtml("{写真|しゃしん}と ことばで、これまでの ことを みます。")}</p>
          <p>ぜんぶで ${n}こ あります。</p>
          <p>こたえたい ところだけで だいじょうぶ。<br>いつでも 「やめる」で おわれます。</p>
          <button class="v3-btn big primary" id="v3start">はじめる <span aria-hidden="true">→</span></button>
        </section>`;
    } else if (v3.screen === "end") {
      const nR = Object.keys(store.d.personReactions).filter((k) => V3_ITEMS.some((x) => x.id === k)).length;
      body = `
        <section class="v3-card v3-center">
          <h1 class="v3-h1" tabindex="-1">おわりました</h1>
          <p>また いつでも みられます。</p>
          <p>${nR ? `えらんだ ことは のこって います。` : "なにも えらばなくても だいじょうぶです。"}</p>
          <div class="v3-nav center">
            <button class="v3-btn big primary" id="v3resume">つづきから みる</button>
            <button class="v3-btn big" id="v3restart">はじめから みる</button>
          </div>
        </section>`;
    } else {
      const r = store.d.personReactions[it.id];
      const imp = (store.d.marks[it.id] || []).some((m) => m.role === "本人");
      const words = store.d.personWords[it.id] || [];
      const markOf = (x) => {
        const rr = store.d.personReactions[x.id], ii = (store.d.marks[x.id] || []).some((m) => m.role === "本人");
        return [rr ? rr.value : "", ii ? "たいせつ" : ""].filter(Boolean).join("・");
      };
      body = `
        <div class="v3-progress">
          <ol class="v3-dots" aria-hidden="true">${V3_ITEMS.map((_, k) => `<li class="${k < v3.i ? "done" : k === v3.i ? "now" : ""}"></li>`).join("")}</ol>
          <span>${v3.i + 1}こめ（のこり ${n - v3.i - 1}こ）</span>
          <button class="v3-btn small" data-panel="all" aria-expanded="${v3.panel === "all"}"><span aria-hidden="true">🗂️</span> ぜんぶ みる</button>
        </div>
        ${v3.panel === "all" ? `
          <nav class="v3-panel" aria-label="ぜんぶ の しゃしん">
            <ol class="v3-grid">${V3_ITEMS.map((x, k) => `<li><button class="v3-thumb" data-go="${k}" ${k === v3.i ? 'aria-current="step"' : ""}>
              <span class="v3-thumb-icon" aria-hidden="true">${x.icon}</span><span>${rubyHtml(x.word)}</span>
              <span class="v3-thumb-age">${ageOf(T.sceneById[x.id].date)}さい</span>
              ${markOf(x) ? `<span class="v3-thumb-mark">✓ ${esc(markOf(x))}</span>` : ""}</button></li>`).join("")}</ol>
            <button class="v3-btn" data-panel="">とじる</button>
          </nav>` : ""}
        <section class="v3-card" aria-labelledby="v3h">
          <div class="v3-pic" aria-hidden="true">${it.icon}</div>
          <h1 class="v3-h1" id="v3h" tabindex="-1">${rubyHtml(it.word)}</h1>
          <p class="v3-when">${ageOf(s.date)}さいの ころ・${esc(placeOf(s.date))}</p>
          <p class="v3-text">${rubyHtml(it.text)}</p>
          ${canSpeak ? `<div class="v3-center"><button class="v3-btn" id="v3speak" aria-pressed="${speaking}"><span aria-hidden="true">🔊</span> <span class="lbl">${speaking ? "とめる" : "きく"}</span></button></div>` : ""}
          ${words.length ? `<div class="v3-words"><h2 class="v3-h2">たした ことば</h2><ul>${words.map((w) => `<li>${esc(w.text)}</li>`).join("")}</ul></div>` : ""}
        </section>
        <fieldset class="v3-react">
          <legend>これは どう？</legend>
          <p class="v3-hint">えらばなくても だいじょうぶ。もう いちど おすと けせます。</p>
          <div class="v3-react-grid">
            ${REACTIONS.map((x) => `<button class="v3-btn react" data-react="${x.v}" ${pressed(r?.value === x.v)} aria-describedby="h-${x.v}">
              <span class="v3-ic" aria-hidden="true">${x.icon}</span><span>${x.v}</span>${chosen(r?.value === x.v)}</button>`).join("")}
            <button class="v3-btn react" id="v3imp" ${pressed(imp)} aria-describedby="h-imp">
              <span class="v3-ic" aria-hidden="true">⭐</span><span>たいせつ</span>${chosen(imp)}</button>
          </div>
          <ul class="sr-only">${REACTIONS.map((x) => `<li id="h-${x.v}">${x.help}</li>`).join("")}<li id="h-imp">たいせつな ことに ほしを つけます</li></ul>
          <p class="v3-feedback" aria-live="polite">${fb ? `<span aria-hidden="true">✔️</span> ${esc(fb)}` : ""}</p>
        </fieldset>
        <div class="v3-addwrap">
          <button class="v3-btn" data-panel="words" aria-expanded="${v3.panel === "words"}"><span aria-hidden="true">✏️</span> ことば を たす</button>
          ${v3.panel === "words" ? `
            <div class="v3-panel" role="region" aria-label="ことば を たす">
              <p class="v3-hint">ことばを おして えらべます。</p>
              <div class="v3-cards">${WORD_CARDS.map((c) => `<button class="v3-btn wordcard" data-word="${esc(c.w)}"><span class="v3-ic" aria-hidden="true">${c.icon}</span><span>${esc(c.w)}</span></button>`).join("")}</div>
              ${Recog ? `<button class="v3-btn" id="v3mic"><span aria-hidden="true">🎤</span> こえで いれる</button>` : ""}
              <form id="v3wordForm" class="v3-wordform">
                <label for="v3word">じぶんで かく</label>
                <input id="v3word" name="w" autocomplete="off">
                <button class="v3-btn" type="submit">たす</button>
              </form>
              <button class="v3-btn" data-panel="">とじる</button>
            </div>` : ""}
        </div>
        <div class="v3-nav">
          <button class="v3-btn big" id="v3prev" ${v3.i === 0 ? "disabled" : ""}><span aria-hidden="true">←</span> まえ</button>
          <button class="v3-btn big" id="v3skip"><span aria-hidden="true">⏭️</span> いまは みない</button>
          <button class="v3-btn big primary" id="v3next">${v3.i === n - 1 ? "おわる" : "つぎ"} <span aria-hidden="true">→</span></button>
        </div>`;
    }

    app.innerHTML = `
      <div class="v3">
        ${topbar}
        ${v3.panel === "help" || v3.panel === "settings" ? openPanel : ""}
        ${body}
        <details class="v3-helper">
          <summary>てつだう ひと へ（支援者向け）</summary>
          <div class="v3-helper-body">
            <p><strong>この画面は、本人が自分で操作して使うことを基本とします。</strong>手伝うときは、本人の操作を支えるかたちで手伝い、代わりに選ばないでください。</p>
            <p>本人が操作しやすくするための工夫：1画面に1場面／反応は4つだけ／「いまは みない」はその場面だけを飛ばす／言葉はカードを押すか声で入れられる／押し間違いの二度押しで取り消されない／「みかた」で文字・ふりがな・声（いつも きく）を本人が選べる／キーボードの ← → でも前後に移れる。</p>
            <p>表示しているのは、本人と相談して掲載に同意した想定の場面だけです（試作のため想定）。身体拘束などの記録、候補、AI推定、支援者の解釈は表示しません。説明文は<strong>支援者が作成した下書き</strong>です。本人と確かめてください。本人の反応は、試行や研究記録への同意の代わりにはなりません。</p>
            <div class="v3-row">
              <label>手伝った人（いない場合は「なし」） <select id="v3helperSel">${HELPERS.map((h) => `<option value="${esc(h)}" ${set.helper === h ? "selected" : ""}>${h || "なし（本人が操作）"}</option>`).join("")}</select></label>
              <label>本人が示した方法 <select id="v3methodSel">${METHODS.map((m) => `<option value="${m}" ${set.method === m ? "selected" : ""}>${m || "（未選択）"}</option>`).join("")}</select></label>
            </div>
            <p><button class="btn" id="v3toStaff">支援者の画面に戻る（立場を「支援者」にする）</button> <a href="#/p/${PID}/v2?focus=${it.id}">この場面を詳細版（V2）で見る</a></p>
          </div>
        </details>
      </div>`;

    // ---- events ----
    const rerender = (focus) => renderV3({}, false, focus);
    const go = (screen, i) => {
      stopSpeech(); v3.screen = screen; v3.panel = ""; v3.feedback = ""; v3.lastSet = null;
      if (i !== undefined) v3.i = i;
      rerender(screen === "item" ? "#v3h" : ".v3-h1");
      if (screen === "item" && set.voice === "auto") say(itemSpeech(V3_ITEMS[v3.i]));
    };
    const feedback = (msg, focus) => { v3.feedback = msg; rerender(focus); if (set.voice === "auto") say(msg); };
    app.querySelectorAll("[data-panel]").forEach((b) => (b.onclick = () => {
      const p = b.dataset.panel; const was = v3.panel;
      v3.panel = p === was ? "" : p;
      rerender(v3.panel ? `.v3-panel button, .v3-panel [data-go]` : `[data-panel="${was}"]`);
    }));
    $("#v3quit").onclick = () => go("end");
    $("#v3start") && ($("#v3start").onclick = () => go("item", 0));
    $("#v3resume") && ($("#v3resume").onclick = () => go("item"));
    $("#v3restart") && ($("#v3restart").onclick = () => go("item", 0));
    $("#v3prev") && ($("#v3prev").onclick = () => go("item", Math.max(0, v3.i - 1)));
    $("#v3next") && ($("#v3next").onclick = () => (v3.i === n - 1 ? go("end") : go("item", v3.i + 1)));
    $("#v3skip") && ($("#v3skip").onclick = () => {
      store.d.personSkips.push({ id: it.id, at: new Date().toISOString() }); store.save();
      v3.i === n - 1 ? go("end") : go("item", v3.i + 1);
    });
    $("#v3speak") && ($("#v3speak").onclick = () => say(itemSpeech(it), { toggle: true }));
    app.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go("item", +b.dataset.go)));
    app.querySelectorAll("[data-react]").forEach((b) => (b.onclick = () => feedback(setReaction(it.id, b.dataset.react), `[data-react="${b.dataset.react}"]`)));
    $("#v3imp") && ($("#v3imp").onclick = () => feedback(toggleImportant(it.id), "#v3imp"));
    app.querySelectorAll("[data-size]").forEach((b) => (b.onclick = () => { set.size = b.dataset.size; store.save(); rerender(`[data-size="${b.dataset.size}"]`); }));
    app.querySelectorAll("[data-ruby]").forEach((b) => (b.onclick = () => { set.ruby = b.dataset.ruby === "1"; store.save(); rerender(`[data-ruby="${b.dataset.ruby}"]`); }));
    app.querySelectorAll("[data-voice]").forEach((b) => (b.onclick = () => { set.voice = b.dataset.voice; store.save(); if (set.voice === "tap") stopSpeech(); rerender(`[data-voice="${b.dataset.voice}"]`); }));
    app.querySelectorAll("[data-word]").forEach((b) => (b.onclick = () => feedback(addWord(it.id, b.dataset.word, "カード"), `[data-word="${b.dataset.word}"]`)));
    $("#v3mic") && ($("#v3mic").onclick = () => {
      const rec = new Recog(); rec.lang = "ja-JP"; rec.interimResults = false;
      v3.feedback = "きいて います…"; T.announce("きいて います");
      rec.onresult = (e) => { const w = e.results[0][0].transcript.trim(); if (w) feedback(addWord(it.id, w, "こえ"), "#v3mic"); };
      rec.onerror = () => feedback("きこえませんでした。もう いちど どうぞ", "#v3mic");
      rec.start();
    });
    $("#v3wordForm") && ($("#v3wordForm").onsubmit = (e) => {
      e.preventDefault();
      const w = new FormData(e.target).get("w").trim();
      if (!w) { feedback("ことばが はいって いません", "#v3word"); return; }
      feedback(addWord(it.id, w, "もじ"), "#v3word");
    });
    $("#v3helperSel").onchange = (e) => { set.helper = e.target.value; store.save(); };
    $("#v3methodSel").onchange = (e) => { set.method = e.target.value; store.save(); };
    $("#v3toStaff").onclick = () => { stopSpeech(); T.setRole("支援者"); location.hash = `#/p/${PID}`; };
    if (fb) T.announce(fb);
    if (focusSel) app.querySelector(focusSel)?.focus({ preventScroll: false });
  }
  // ← → move between pictures (arrow keys only; no single-character shortcuts, WCAG 2.1.4)
  document.addEventListener("keydown", (e) => {
    if (document.body.dataset.view !== "v3" || v3.screen !== "item") return;
    if (e.target.closest?.("input, textarea, select") || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowRight") { e.preventDefault(); document.getElementById("v3next")?.click(); }
    if (e.key === "ArrowLeft" && v3.i > 0) { e.preventDefault(); document.getElementById("v3prev")?.click(); }
  });
  T.route(`#/p/${PID}/v3`, "v3", "わたしの あゆみ（本人向け絵巻物 V3）", (params) => renderV3(params));

  // =====================================================================
  // 会議画面 (F-7)
  // =====================================================================
  const STEPS = [
    { id: "consent", name: "はじめに：参加と記録の意思確認" },
    { id: "taste", name: "① 一緒に味わう" },
    { id: "questions", name: "② 3つの問い" },
    { id: "compare", name: "③ 見方の比較" },
    { id: "summary", name: "④ 整理" },
    { id: "plan", name: "⑤ 支援を変えた場合を考える" },
    { id: "close", name: "⑥ おわりに" },
  ];
  const KINDS = ["本人の表現", "観察事実", "解釈", "本人の意思の仮説", "提案", "質問"];
  const CONSENT = ["本人と確認できた", "本人未確認", "今回は尋ねていない", "本人が回答を見送った", "記録を希望しない"];
  const mt = { step: "consent", q: 1 };
  const info = M.info;
  const participants = () => M.participants.map((p, i) => ({ id: p["参加者ID"], name: p["氏名"], role: p["役割・関係"], view: p["議論上の視点"], color: T.PART_COLORS[i] }));
  const qLabel = (n) => ["", "①", "②", "③"][n];
  const stmtHtml = (s) => {
    const p = participants().find((x) => x.id === s["参加者ID"]);
    return `<li class="stmt"><span class="pdot" style="background:${p?.color || "var(--muted)"}" aria-hidden="true"></span><div>
      <div class="who">${esc(s["氏名"])}（${esc(p?.view || s["役割"])}）・<b>${esc(s["発言の種類"])}</b> ${s["模擬フラグ"] === "この会議で入力" ? '<span class="badge ok">この会議で入力</span>' : '<span class="badge mock">模擬</span>'}</div>
      ${esc(s["発言内容"])}
      <div class="refs">${T.parseRefs(s["根拠・未確認事項"]).map((r) => T.refChip(r)).join(" ")} <span class="note">${esc(s["根拠・未確認事項"])}</span></div></div></li>`;
  };
  function logEvent(kind, note) { MT.log.push({ kind, note, at: new Date().toISOString() }); store.save(); }

  function renderMeeting(params = {}, _keep, focusSel) {
    const app = T.app();
    T.crumbs().innerHTML = `<a href="#/">ホーム</a> › <a href="#/p/${PID}">P001 ダッシュボード</a> › ケース会議`;
    if (params.step === "whatif") params.step = "plan"; // merged into 支援を変えた場合を考える
    if (params.step && STEPS.some((x) => x.id === params.step)) mt.step = params.step;
    const ps = participants();
    const presenting = document.body.classList.contains("presenting");
    const sum = Object.fromEntries(M.summary.map((x) => [x["項目ID"], x]));
    let panel = "";

    if (mt.step === "consent") {
      const last = store.d.consents[store.d.consents.length - 1];
      panel = `
        <h2>はじめに：参加と記録の意思確認</h2>
        <p>会議の冒頭で、本人の参加と記録の意思を確かめます。説明・確認は、日常ケアを直接担当しない研究員が担います（参考資料3）。沈黙や無反応を同意・拒否として扱いません。</p>
        <form id="consentForm" class="evt">
          <fieldset><legend>参加と記録の意思（確認状況）</legend>
            ${CONSENT.map((c, i) => `<label class="radio"><input type="radio" name="result" value="${c}" ${i === 0 && !last ? "" : last?.result === c ? "checked" : ""} required> ${c}</label>`).join("")}
          </fieldset>
          <label>確認の方法（本人に合う伝え方）<input name="method" value="${esc(last?.method || "")}" placeholder="例: 写真カードで「はなす／きく／やすむ」を示した"></label>
          <label>確認した人<input name="by" value="${esc(last?.by || "")}" placeholder="例: 研究員A"></label>
          <button class="btn primary" type="submit">記録する</button>
          ${last ? `<p class="note">最終記録: ${esc(fmtDate(last.at.slice(0, 10)))} ${esc(last.result)}（${esc(last.by || "確認者未記入")}）</p>` : ""}
        </form>`;
    } else if (mt.step === "taste") {
      const sc = T.sceneById[info["場面ID"]];
      const voices = (T.unitsByScene[sc.id] || []).flatMap((u) => (u.quotes || []).filter((q) => q.speaker === "本人"));
      panel = `
        <h2>① 一緒に味わう：${esc(info["場面ID"])}「${esc(info["主題"])}」</h2>
        <p class="note">結論を急がず、困った場面・安心した場面・楽しみの場面を、本人の表現に立ち戻りながら一緒に眺めます。</p>
        <div class="box"><h3 class="box-h">原記録 ${esc(sc.rawId)}（${fmtDate(sc.date)}）</h3><p class="meeting-text">${esc(sc.text)}</p>
          <div class="note">${esc(sc.recorder)}</div>
          ${voices.length ? `<p><b>本人の表現（候補・要確認）:</b> ${voices.map((q) => `「${esc(q.text)}」`).join(" ")}</p>` : ""}
        </div>
        <h3>ライフストーリーで見る</h3>
        <div class="viz mini-viz" id="meetMini" role="img" aria-label="ライフストーリー全体概要の縮小図。詳しくは下のリンクから全体概要版または詳細版を開いてください。"></div>
        <p><a class="btn" href="#/p/${PID}/v1?sel=${sc.id}">全体概要（V1）で見る</a> <a class="btn" href="#/p/${PID}/v2?focus=${sc.id}">詳細版（V2）で見る</a> <a class="btn" href="#/p/${PID}/v3">本人と一緒に絵巻物（V3）を見る</a></p>`;
    } else if (mt.step === "questions") {
      const q = M.questions.find((x) => +x["問ID"] === mt.q);
      const list = M.statements.filter((s) => +s["問い番号"] === mt.q);
      panel = `
        <h2>② 3つの問い</h2>
        <div class="seg" role="group" aria-label="問いを選ぶ">
          ${M.questions.map((x) => `<button class="btn" data-q="${x["問ID"]}" aria-pressed="${+x["問ID"] === mt.q}">問い${qLabel(+x["問ID"])} ${esc(x["種類"])}</button>`).join("")}
        </div>
        <div class="box q-current"><h3 class="box-h">問い${qLabel(mt.q)}：${esc(q["種類"])} <span class="badge mock">模擬</span></h3>
          <p class="meeting-text">${esc(q["場面別の問い"])}</p><p class="note">${esc(q["設計上の目的"])}。問いは正解へ誘導しません。</p></div>
        <h3>出された見方（${list.length}件）</h3>
        <ul class="plain-list">${list.map(stmtHtml).join("")}</ul>
        <h3>見方を加える</h3>
        <form id="stmtForm" class="evt" novalidate>
          <div class="two-col">
            <label>だれの見方か（立場）<select name="pid" required><option value="">選んでください</option>${ps.map((p) => `<option value="${p.id}">${esc(p.name)}（${esc(p.view)}）</option>`).join("")}<option value="person">本人</option><option value="peer">ピアサポーター</option></select></label>
            <label>種類<select name="kind" required><option value="">選んでください</option>${KINDS.map((k) => `<option>${k}</option>`).join("")}</select></label>
          </div>
          <label>内容<textarea name="text" rows="3" required></textarea></label>
          <label>根拠・未確認事項（例: 原記録10-08／C1008／U1008_01）<input name="ref" value="原記録${esc(info["原記録ID"])}／${esc(info["場面ID"])}"></label>
          <p class="note">「本人の表現」には本人が示した言葉・動きをそのまま書きます。周囲の推測は「解釈」「本人の意思の仮説」に分けます（P-2）。</p>
          <p id="stmtErr" class="form-error" role="alert" hidden></p>
          <button class="btn primary" type="submit">加える</button>
        </form>`;
    } else if (mt.step === "compare") {
      const cell = (pid, n) => M.statements.filter((s) => s["参加者ID"] === pid && +s["問い番号"] === n);
      const rows = ps.concat([{ id: "person", name: "本人", view: "本人" }, { id: "peer", name: "ピアサポーター", view: "ピア" }]);
      panel = `
        <h2>③ 見方の比較</h2>
        <p class="note">共通点・違い・分からなさを残します。多数決やまとめで一本化しません（FR-7.7）。</p>
        <div class="table-scroll"><table class="plain"><caption class="sr-only">参加者ごと・問いごとの見方</caption>
          <thead><tr><th scope="col">参加者（視点）</th>${[1, 2, 3].map((n) => `<th scope="col">問い${qLabel(n)}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((p) => `<tr><th scope="row">${p.color ? `<span class="pdot inline" style="background:${p.color}" aria-hidden="true"></span>` : ""}${esc(p.name)}<div class="note">${esc(p.view)}</div></th>
            ${[1, 2, 3].map((n) => { const c = cell(p.id, n); return `<td>${c.length ? c.map((s) => `<div><b>${esc(s["発言の種類"])}</b>：${esc(T.clip(s["発言内容"], 44))}</div>`).join("") : '<span class="muted">—</span>'}</td>`; }).join("")}</tr>`).join("")}</tbody>
        </table></div>
        <form id="compareForm" class="evt">
          <label>共通していること<textarea name="common" rows="2">${esc(MT.compare.common || "")}</textarea></label>
          <label>違っていること（だれの見方か・根拠）<textarea name="diff" rows="2">${esc(MT.compare.diff || "")}</textarea></label>
          <label>まだ分からないこと<textarea name="unknown" rows="2">${esc(MT.compare.unknown || "")}</textarea></label>
          <button class="btn primary" type="submit">保存する</button>
        </form>`;
    } else if (mt.step === "summary") {
      panel = `
        <h2>④ 整理</h2>
        <form id="summaryForm" class="evt">
          ${M.summary.map((x) => `<label>${esc(x["項目名"])} <span class="note">（${esc(x["位置づけ"])}）</span><textarea name="${x["項目ID"]}" rows="3">${esc(x["内容"] === "None" ? "" : x["内容"])}</textarea></label>`).join("")}
          <button class="btn primary" type="submit">保存する</button>
        </form>`;
    } else if (mt.step === "plan") {
      const WP = { "W-stay": "今のまま", "W-change": "変えた場合", "W-confirm": "確かめること" };
      const gist = (t) => T.clip(String(t).replace(/^【[^】]*】/, "").split("。")[0] + "。", 46);
      panel = `
        <h2>⑤ 支援を変えた場合を考える</h2>
        <p class="note">今のまま続けた場合と、支援を変えた場合を並べて考えます。どれも仮説で、まだ確かめていません。</p>
        <form id="whatifForm" class="evt">
          <div class="whatif-row">${M.whatif.map((x) => `<section class="whatif" aria-labelledby="mw-${x["シナリオID"]}">
            <h3 id="mw-${x["シナリオID"]}">${esc(WP[x["シナリオID"]] || x["観点"])}</h3>
            <p class="gist">${esc(gist(x["内容"]))}</p>
            <details><summary>詳しく見る・書き直す<span class="sr-only">（${esc(WP[x["シナリオID"]] || "")}）</span></summary>
              <textarea name="${x["シナリオID"]}" rows="5" aria-label="${esc(WP[x["シナリオID"]] || x["観点"])}の内容">${esc(x["内容"])}</textarea>
              <span class="badge">${esc(x["検証状況"])}</span></details>
          </section>`).join("")}</div>
          <button class="btn" type="submit">書き直した内容を保存する</button>
        </form>
        <h3>変えるなら、小さく試す計画を決める</h3>
        <p class="note">拒否・苦痛があれば直ちに止めます（P-5）。* は必須です。</p>
        <form id="planForm" class="evt" novalidate>
          <div class="two-col">
            <label>何を（いまの関わり・環境）*<textarea name="from" rows="2" required aria-describedby="planErr"></textarea></label>
            <label>何へ変えるか *<textarea name="to" rows="2" required aria-describedby="planErr"></textarea></label>
          </div>
          <div class="two-col">
            <label>担当 *<input name="owner" required aria-describedby="planErr"></label>
            <label>場面・条件<input name="scene" placeholder="例: 夕方 配膳前"></label>
          </div>
          <div class="two-col">
            <label>予定する時期<input name="when" placeholder="例: 1回目から2週間"></label>
            <label>余韻を確かめる日<input type="date" name="afterglowDate"></label>
          </div>
          <label>何に目を向けるか（観察する場面・拾い方）<textarea name="observe" rows="2"></textarea></label>
          <label>止める条件 *<textarea name="stop" rows="2" required aria-describedby="planErr">拒否・苦痛の表現があれば直ちに止め、必要な支援を続ける</textarea></label>
          <label>本人の試行意思の確認方法<input name="consent" placeholder="例: 写真カードで「やる／やらない／あとで」を示す"></label>
          <p id="planErr" class="form-error" role="alert" hidden></p>
          <button class="btn primary" type="submit">試行計画を登録する</button>
        </form>
        ${store.d.plans.length ? `<h3>登録済みの試行計画</h3><ul class="plain-list">${store.d.plans.map((p) => `<li class="box"><b>${esc(p.id)}</b> ${esc(p.change)}（担当 ${esc(p.owner)}）</li>`).join("")}</ul>` : ""}`;
    } else {
      panel = `
        <h2>⑥ おわりに</h2>
        <p>会議を終えると、次の内容がダッシュボードに反映されます（FR-0.4.2）。</p>
        <ul>
          <li>加えた見方：${MT.statements.length}件</li>
          <li>試行計画：${store.d.plans.length}件</li>
          <li>整理・支援を変えた場合の編集：${Object.keys(MT.summary).length + Object.keys(MT.whatif).length}項目</li>
          <li>休憩・中断の記録：${MT.log.length}件</li>
        </ul>
        <p class="note">本人にわかる形でのまとめの共有（V3・様式E）と、次回の確認日の設定を忘れずに。</p>
        <button class="btn primary big" id="closeMeeting">会議を終えてダッシュボードへ</button>`;
    }

    const idx = STEPS.findIndex((x) => x.id === mt.step);
    app.innerHTML = `
      <div class="meeting">
        <div class="dash-head">
          <h1>ケース会議 ${esc(info["会議ID"])}（1回目・模擬）</h1>
          <span class="note">焦点 <span class="chip" role="button" tabindex="0" data-ref-type="scene" data-ref-id="${info["場面ID"]}">${info["場面ID"]} ${esc(info["主題"])}</span></span>
          <span class="badge mock">模擬データを含む</span>
          <span style="flex:1"></span>
          <button class="btn" id="presentBtn" aria-pressed="${presenting}">発表モード</button>
          <button class="btn" id="breakBtn">休憩を記録</button>
          <button class="btn" id="pauseBtn">中断・延期を記録</button>
        </div>
        <div class="participants" aria-label="参加者">
          ${ps.map((p) => `<span class="chip static"><span class="pdot inline" style="background:${p.color}" aria-hidden="true"></span>${esc(p.name)}<span class="muted">（${esc(p.view)}）</span></span>`).join("")}
          <span class="chip static">本人<span class="muted">（参加の形は本人に合わせる。着席・発話を条件にしない）</span></span>
        </div>
        <div class="meeting-grid">
          <nav class="steps" aria-label="会議の進め方">
            <ol>${STEPS.map((x) => `<li><a href="#/p/${PID}/meeting?step=${x.id}" ${x.id === mt.step ? 'aria-current="step"' : ""}>${esc(x.name)}</a></li>`).join("")}</ol>
          </nav>
          <section class="panel meeting-panel" id="meetPanel" tabindex="-1" aria-label="${esc(STEPS[idx].name)}">
            ${panel}
            <div class="step-nav">
              ${idx > 0 ? `<a class="btn" href="#/p/${PID}/meeting?step=${STEPS[idx - 1].id}">← ${esc(STEPS[idx - 1].name)}</a>` : ""}
              <span style="flex:1"></span>
              ${idx < STEPS.length - 1 ? `<a class="btn primary" href="#/p/${PID}/meeting?step=${STEPS[idx + 1].id}">${esc(STEPS[idx + 1].name)} →</a>` : ""}
            </div>
          </section>
        </div>
        ${MT.log.length ? `<details class="card" style="margin-top:12px"><summary>休憩・中断の記録（${MT.log.length}件）</summary><ul>${MT.log.map((l) => `<li>${esc(l.at.slice(0, 16).replace("T", " "))} ${esc(l.kind)}</li>`).join("")}</ul></details>` : ""}
      </div>`;

    if ($("#meetMini")) T.renderTimeline($("#meetMini"), { compact: true });
    const save = (msg, focus) => { store.save(); renderMeeting({}, false, focus); T.announce(msg); };
    $("#presentBtn").onclick = () => { document.body.classList.toggle("presenting"); renderMeeting({}, false, "#presentBtn"); T.announce(document.body.classList.contains("presenting") ? "発表モードにしました" : "発表モードを解除しました"); };
    $("#breakBtn").onclick = () => { logEvent("休憩"); save("休憩を記録しました", "#breakBtn"); };
    $("#pauseBtn").onclick = () => { logEvent("中断・延期"); save("中断・延期を記録しました", "#pauseBtn"); };
    app.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { mt.q = +b.dataset.q; renderMeeting({}, false, `[data-q="${mt.q}"]`); }));

    const form = (id, fn) => { const f = $(id); if (f) f.onsubmit = (e) => { e.preventDefault(); fn(new FormData(f), f); }; };
    form("#consentForm", (fd) => { store.d.consents.push({ result: fd.get("result"), method: fd.get("method"), by: fd.get("by"), at: new Date().toISOString(), meeting: info["会議ID"] }); save("意思確認を記録しました", "#consentForm button"); });
    form("#stmtForm", (fd) => {
      const err = $("#stmtErr");
      if (!fd.get("pid") || !fd.get("kind") || !fd.get("text").trim()) { err.hidden = false; err.textContent = "「だれの見方か」「種類」「内容」を入力してください。"; return; }
      const pid = fd.get("pid");
      const p = ps.find((x) => x.id === pid);
      const st = { "発言ID": `M-${MT.statements.length + 1}`, "会議ID": info["会議ID"], "場面ID": info["場面ID"], "問い番号": String(mt.q),
        "参加者ID": pid, "氏名": p ? p.name : pid === "person" ? "本人" : "ピアサポーター", "役割": p ? p.role : "", "発言の種類": fd.get("kind"),
        "発言内容": fd.get("text").trim(), "根拠・未確認事項": fd.get("ref"), "模擬フラグ": "この会議で入力" };
      MT.statements.push(st); M.statements.push(st);
      save("見方を加えました", "#stmtForm textarea");
    });
    form("#compareForm", (fd) => { MT.compare = Object.fromEntries(fd); save("見方の比較を保存しました", "#compareForm button"); });
    form("#summaryForm", (fd) => { for (const [k, v] of fd) { MT.summary[k] = v; const it = M.summary.find((x) => x["項目ID"] === k); if (it) it["内容"] = v; } save("整理を保存しました", "#summaryForm button"); });
    form("#whatifForm", (fd) => { for (const [k, v] of fd) { MT.whatif[k] = v; const it = M.whatif.find((x) => x["シナリオID"] === k); if (it) it["内容"] = v; } save("支援を変えた場合の内容を保存しました", "#whatifForm button"); });
    form("#planForm", (fd, f) => {
      const missing = ["from", "to", "owner", "stop"].filter((k) => !String(fd.get(k) || "").trim());
      const err = $("#planErr");
      if (missing.length) {
        const names = { from: "何を", to: "何へ変えるか", owner: "担当", stop: "止める条件" };
        err.hidden = false; err.textContent = `入力が必要です：${missing.map((k) => names[k]).join("・")}`;
        f.querySelector(`[name="${missing[0]}"]`).focus();
        return;
      }
      const id = `P${store.d.plans.length + 2}`; // P1 is the mock plan from the seed meeting
      store.d.plans.push({ id, meeting: info["会議ID"], change: `${fd.get("from")} → ${fd.get("to")}`, owner: fd.get("owner"), scene: fd.get("scene"),
        when: fd.get("when"), afterglowDate: fd.get("afterglowDate"), observe: fd.get("observe"), stop: fd.get("stop"), consent: fd.get("consent"), at: new Date().toISOString() });
      save(`試行計画 ${id} を登録しました。ダッシュボードの実践結果に表示されます`, "#planForm button");
    });
    $("#closeMeeting") && ($("#closeMeeting").onclick = () => { logEvent("会議終了"); document.body.classList.remove("presenting"); location.hash = `#/p/${PID}`; T.announce("会議を終えました。ダッシュボードに反映しました"); });
    if (focusSel) app.querySelector(focusSel)?.focus();
    else if (params.step) $("#meetPanel h2")?.setAttribute("tabindex", "-1"), $("#meetPanel h2")?.focus();
  }
  T.route(`#/p/${PID}/meeting`, "meeting", "ケース会議（F-7）", (params) => renderMeeting(params));
})();
