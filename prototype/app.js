/* TOMONI ケース会議ダッシュボード + V1 全体概要版（試作）
 * Requirements: docs/requirements.md F-0, F-3.1, F-3.4, F-3.7
 * Data: window.SEED (scripts/build_seed.py). Browser-local state only.
 */
(() => {
  "use strict";
  const S = window.SEED;
  const PID = "P001";
  const NS = "http://www.w3.org/2000/svg";

  // ---------- indexes ----------
  const by = (arr, key) => Object.fromEntries(arr.map((x) => [x[key], x]));
  const group = (arr, key) => arr.reduce((m, x) => ((m[x[key]] ||= []).push(x), m), {});
  const scenes = S.scenes;
  const sceneById = by(scenes, "id");
  const unitById = by(S.units, "id");
  const unitsByScene = group(S.units, "sceneId");
  const candsByScene = group(S.candidates, "sceneId");
  const candsByUnit = group(S.candidates, "unitId");
  const rawById = by(S.raw, "id");
  const M = S.meeting;
  const participantById = by(M.participants, "参加者ID");
  const birthYear = S.persons[0].birthYear;

  const LAYERS = [
    { id: "illness", name: "病気", sub: "身体・健康・医療" },
    { id: "life", name: "生活", sub: "暮らし・関係・本人らしさ" },
    { id: "institution", name: "社会制度", sub: "判定・措置・入退所・制度" },
  ];
  const layerName = Object.fromEntries(LAYERS.map((l) => [l.id, l.name]));
  const CAND_LABEL = { intent: "意思表出", like: "好き・苦手", trial: "支援試行", body: "身体サイン", hypo: "解釈・仮説" };
  const KIND_LABEL = { support: "支援・活動の記録", family: "家族の記録", medical: "看護・医療の記録", consult: "判定・相談・会議の記録" };
  const REL = {
    same_system: { name: "同じ制度の経過" },
    transition: { name: "移行（場の変化）" },
    overlap: { name: "時期が重なる" },
    theme: { name: "同じ人・もの・テーマ" },
    trigger: { name: "きっかけの候補" },
    institutional: { name: "制度による対応" },
    participant: { name: "参加者が結んだ見方" },
  };
  const PHASES = ["0回目", "1回目", "1.5回目", "2回目", "まとめ", "追跡"];
  const PART_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];

  // ---------- local store (per-browser convenience only) ----------
  const KEY = "tomoni_proto_v1";
  const store = (() => {
    let d = {};
    try { d = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { d = {}; }
    d.marks ||= {}; d.events ||= []; d.relStatus ||= {}; d.qStatus ||= {};
    return {
      d,
      save() { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* storage unavailable */ } },
    };
  })();
  const role = () => document.getElementById("roleSelect").value;
  // remember the operator role on this device; 本人 opens straight into the 本人向け screen
  if (store.d.role) document.getElementById("roleSelect").value = store.d.role;
  function setRole(r) { document.getElementById("roleSelect").value = r; store.d.role = r; store.save(); }

  // ---------- view state ----------
  const st = {
    focusQ: null,        // question number (1..3) or null
    selected: null,      // scene id
    layers: { illness: true, life: true, institution: true },
    theme: "",
    viewBy: "all",
    domain: null,        // [t0, t1] ms when zoomed
    relTypes: { same_system: false, transition: true, overlap: false, trigger: false, institutional: true, participant: true }, // start with few lines; add as needed
  };

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const t = (dateStr) => new Date(dateStr + "T00:00:00").getTime();
  const fmtDate = (d) => d ? d.replace(/-/g, ".") : "";
  const yearOf = (d) => +d.slice(0, 4);
  const clip = (s, n = 60) => (s.length > n ? s.slice(0, n) + "…" : s);
  const svg = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };

  // quoted phrases 「…」 carry a speaker (本人／母／父／支援者／その他の家族／不明) from build_seed.py
  function quoteLabel(q) {
    if (q.speaker === "本人") return "本人の表現（候補・要確認）";
    if (q.speaker === "不明") return "引用文：発言者未確認";
    if (q.speaker === "支援者" && /記録の文言/.test(q.basis)) return "支援者（記録の文言）";
    return `${q.speaker}の発言`;
  }
  const spkClass = (q) => ({ 本人: "spk-self", 母: "spk-mother", 父: "spk-father", 支援者: "spk-staff", 不明: "spk-unknown" }[q.speaker] || "spk-family");
  const quoteLine = (q, withBasis) => `<li><span class="spk ${spkClass(q)}">${esc(quoteLabel(q))}</span> 「${esc(q.text)}」${withBasis ? ` <span class="note">（判定の手がかり: ${esc(q.basis)}・${esc(q.unit || "")}）</span>` : ""}</li>`;

  // evidence refs like "原記録10-08／C1008／U1008_02・03"
  function parseRefs(text) {
    const out = [];
    const s = String(text || "");
    for (const m of s.matchAll(/C\d{4}/g)) out.push({ type: "scene", id: m[0] });
    for (const m of s.matchAll(/U(\d{4})_(\d{2})((?:・\d{2})*)/g)) {
      out.push({ type: "unit", id: `U${m[1]}_${m[2]}` });
      for (const extra of (m[3] || "").split("・").filter(Boolean)) out.push({ type: "unit", id: `U${m[1]}_${extra}` });
    }
    for (const m of s.matchAll(/原記録\s*(\d{2}-\d{2})/g)) out.push({ type: "raw", id: m[1] });
    return out.filter((r, i, a) => a.findIndex((x) => x.type === r.type && x.id === r.id) === i);
  }
  const refLabel = (r) => (r.type === "raw" ? `原記録 ${r.id}` : r.id);
  const refChip = (r) => `<span class="chip" role="button" tabindex="0" data-ref-type="${r.type}" data-ref-id="${esc(r.id)}">${esc(refLabel(r))}</span>`;

  function questionRefs(qno) {
    const q = M.questions.find((x) => +x["問ID"] === qno);
    const refs = [{ type: "scene", id: q["参照場面ID"] }];
    for (const s of M.statements.filter((x) => +x["問い番号"] === qno)) refs.push(...parseRefs(s["根拠・未確認事項"]));
    return refs.filter((r, i, a) => a.findIndex((x) => x.type === r.type && x.id === r.id) === i);
  }
  function questionScenes(qno) {
    const set = new Set();
    for (const r of questionRefs(qno)) {
      if (r.type === "scene") set.add(r.id);
      if (r.type === "unit" && unitById[r.id]) set.add(unitById[r.id].sceneId);
      if (r.type === "raw") scenes.filter((s) => s.rawId === r.id).forEach((s) => set.add(s.id));
    }
    return set;
  }

  // importance (F-3.7): people only, person's mark first
  function marksFor(id) { return store.d.marks[id] || []; }
  function importanceLevel(id) {
    let ms = marksFor(id);
    if (st.viewBy !== "all") ms = ms.filter((m) => m.role === st.viewBy);
    if (ms.some((m) => m.role === "本人")) return 4;
    if (ms.length >= 2) return 3;
    if (ms.length === 1) return 2;
    return 1;
  }
  const RADIUS = { 1: 5, 2: 7.5, 3: 10, 4: 12.5 };
  function toggleMark(id) {
    const r = role();
    const ms = store.d.marks[id] ||= [];
    const i = ms.findIndex((m) => m.role === r);
    if (i >= 0) ms.splice(i, 1);
    else ms.push({ role: r, at: new Date().toISOString() });
    store.save();
  }
  const relStatus = (rel) => store.d.relStatus[rel.id] || rel.status;

  // practice events recorded in this browser (F-8 / FR-3.1.12)
  const events = () => store.d.events;

  // ---------- tooltip ----------
  const tip = $("#tooltip");
  function showTip(html, ev) {
    clearTimeout(tipTimer);
    tip.innerHTML = html; tip.hidden = false;
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
    if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  // 1.4.13: tooltip is hoverable (short grace period), dismissible (Esc) and persistent while hovered
  let tipTimer = 0;
  const hideTipNow = () => { clearTimeout(tipTimer); tip.hidden = true; };
  const hideTip = () => { clearTimeout(tipTimer); tipTimer = setTimeout(() => (tip.hidden = true), 350); };
  tip.addEventListener("mouseenter", () => clearTimeout(tipTimer));
  tip.addEventListener("mouseleave", hideTip);
  function showTipAt(html, el) {
    const r = el.getBoundingClientRect();
    showTip(html, { clientX: r.left + Math.min(r.width, 40), clientY: r.bottom });
  }
  // status messages (WCAG 4.1.3): never auto-hidden
  function announce(msg) {
    const box = $("#status");
    box.textContent = "";
    requestAnimationFrame(() => (box.textContent = msg));
  }
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollBehavior = (smooth = true) => (smooth && !reduceMotion() ? "smooth" : "auto");
  function refExcerpt(type, id) {
    if (type === "scene" && sceneById[id]) { const s = sceneById[id]; return `<b>${id}</b> ${fmtDate(s.date)}<br>${esc(clip(s.text, 120))}`; }
    if (type === "unit" && unitById[id]) return `<b>${id}</b><br>${esc(unitById[id].text)}`;
    if (type === "raw" && rawById[id]) return `<b>原記録 ${id}</b> ${esc(rawById[id].heading)}<br>${esc(clip(rawById[id].text, 120))}`;
    return esc(id);
  }
  document.addEventListener("mouseover", (e) => {
    const c = e.target.closest("[data-ref-type]");
    if (c) showTip(refExcerpt(c.dataset.refType, c.dataset.refId), e);
  });
  document.addEventListener("mouseout", (e) => { if (e.target.closest("[data-ref-type]")) hideTip(); });
  document.addEventListener("focusin", (e) => {
    const c = e.target.closest?.("[data-ref-type]");
    if (c) showTipAt(refExcerpt(c.dataset.refType, c.dataset.refId), c);
  });
  document.addEventListener("focusout", (e) => { if (e.target.closest?.("[data-ref-type], .node")) hideTipNow(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!tip.hidden) { hideTipNow(); return; }
    if (!drawer.hidden) closeDrawer();
  });
  // chips are spans for layout; make them keyboard operable (2.1.1)
  document.addEventListener("keydown", (e) => {
    const c = e.target.closest?.("[data-ref-type]");
    if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); c.click(); }
  });
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-ref-type]");
    if (!c) return;
    hideTipNow();
    const { refType, refId } = c.dataset;
    const base = c.dataset.crumb ? [{ label: c.dataset.crumb }] : [];
    if (refType === "scene") openScene(refId, base);
    else if (refType === "unit") openScene(unitById[refId]?.sceneId, base, refId);
    else if (refType === "raw") openRaw(refId, base);
  });

  // ---------- drawer: drill-down to records and the original (F-0.3) ----------
  const drawer = $("#drawer");
  let drawerStack = [];
  let drawerReturn = null;
  const closeDrawer = () => {
    if (drawer.hidden) return;
    drawer.hidden = true; drawerStack = [];
    if (drawerReturn && document.contains(drawerReturn)) drawerReturn.focus();
    drawerReturn = null;
  };
  $("#drawerClose").onclick = closeDrawer;
  function renderDrawerCrumbs() {
    const nav = $("#drawerCrumbs");
    const here = location.hash.includes("/v1") ? "V1 全体概要版" : location.hash.includes("/p/") ? "ダッシュボード" : "ホーム";
    nav.innerHTML = [`<span>${here}</span>`]
      .concat(drawerStack.map((c, i) => (i === drawerStack.length - 1 ? `<b aria-current="page">${esc(c.label)}</b>` : `<a href="#" data-i="${i}">${esc(c.label)}</a>`)))
      .join(" › ");
    nav.querySelectorAll("a[data-i]").forEach((a) => (a.onclick = (ev) => {
      ev.preventDefault();
      const i = +a.dataset.i; const c = drawerStack[i]; drawerStack = drawerStack.slice(0, i); c.open();
    }));
  }
  function pushDrawer(label, open, html) {
    if (drawer.hidden && !drawerReturn) drawerReturn = document.activeElement;
    drawerStack.push({ label, open });
    $("#drawerBody").innerHTML = html;
    drawer.hidden = false;
    renderDrawerCrumbs();
    $("#drawerBody").scrollTop = 0;
    const h = $("#drawerBody h3");
    if (h) { h.id = "drawerTitle"; h.tabIndex = -1; h.focus(); }
  }
  function badgeRow(s) {
    return `<span class="badge cand">原記録由来・構造化</span> <span class="badge cand">${esc(s.status)}</span> <span class="badge">${esc(s.certainty)}</span>`;
  }
  function openScene(id, base = [], hlUnit = null) {
    const s = sceneById[id];
    if (!s) return;
    if (base.length && !drawerStack.length) drawerStack = base.map((b) => ({ label: b.label, open: closeDrawer }));
    const units = (unitsByScene[id] || []).sort((a, b) => a.order - b.order);
    const rels = S.relations.filter((r) => r.from === id || r.to === id);
    const ms = marksFor(id);
    const layersHtml = s.layers.map((l) => `<div><span class="layer-dot ld-${l}"></span> <b>${layerName[l]}</b>${l === s.primary ? "（主）" : ""} <span class="note">根拠: ${esc(s.layerReasons[l].join("、"))}</span> <span class="badge cand">候補</span></div>`).join("");
    const unitsHtml = units.map((u) => {
      const cs = candsByUnit[u.id] || [];
      return `<div class="unit ${u.id === hlUnit ? "hl" : ""}" id="u-${u.id}">
        <div><span class="note">${u.id}</span> ${esc(u.text)}</div>
        <div class="note">タグ候補: ${esc(u.tags || "なし")} ／ ${esc(u.obs)}</div>
        ${(u.quotes || []).length ? `<ul class="quote-list">${u.quotes.map((q) => quoteLine(q, true)).join("")}</ul>` : ""}
        ${cs.map((c) => `<div class="cand-line">▸ ${CAND_LABEL[c.type]}（${esc(c.kind)}）<span class="badge cand">${esc(c.status || "要確認")}</span></div>`).join("")}
      </div>`;
    }).join("");
    const relHtml = rels.length ? rels.map((r) => {
      const other = r.from === id ? r.to : r.from;
      const stt = relStatus(r);
      return `<div class="rel-item"><b>${REL[r.type].name}</b>${r.direction ? `（${r.direction === "constrain" ? "制約した" : "可能にした"}：${esc(r.system)}）` : ""}
        → <span class="chip" data-ref-type="scene" data-ref-id="${other}">${other} ${fmtDate(sceneById[other].date)}</span>
        <div class="note">${esc(r.desc)}</div>
        <div class="note">見方: ${esc(r.by)} ／ ${esc(r.confirm)} ／ 状態: <b>${esc(stt)}</b>
          <button class="btn small" data-rel="${r.id}" data-set="採用">採用</button>
          <button class="btn small" data-rel="${r.id}" data-set="棄却">棄却</button>
          <button class="btn small" data-rel="${r.id}" data-set="候補">候補に戻す</button></div></div>`;
    }).join("") : `<div class="empty">関係はまだありません。</div>`;
    const html = `
      <h3>${s.id} ${fmtDate(s.date)}（${yearOf(s.date) - birthYear}歳ごろ）</h3>
      <div class="note">${esc(s.heading)}</div>
      <div class="note">${esc(s.recorder)} ／ ${KIND_LABEL[s.kind]}</div>
      <div style="margin:6px 0">${badgeRow(s)} ${s.restraint ? '<span class="badge stop">◆ 権利制限的対応を含む（D08）</span>' : ""}</div>
      <h4>場面の原文</h4><div class="rawtext">${esc(s.text)}</div>
      <h4>レイヤ（自動候補・要人手確定）</h4>${layersHtml}
      <h4>大切さの印</h4>
      <div>${ms.length ? ms.map((m) => `<span class="badge ${m.role === "本人" ? "ok" : ""}">${esc(m.role)}</span>`).join(" ") : '<span class="empty">まだ付いていません（未評価）</span>'}
        <button class="btn small" id="markBtn">${ms.some((m) => m.role === role()) ? "印を取り消す" : "大切だと思う（" + esc(role()) + "）"}</button></div>
      <h4>記述ユニットと自動抽出候補（${units.length}）</h4>${unitsHtml}
      <h4>関係</h4>${relHtml}
      <h4>原典</h4><button class="btn" id="rawBtn">原記録 ${s.rawId} の全文を開く</button>
      <button class="btn" id="v1Btn">V1 で位置を見る</button>
      <button class="btn" id="v2Btn">V2 詳細版で開く</button>`;
    pushDrawer(`${s.id}`, () => openScene(id, [], hlUnit), html);
    if (hlUnit) document.getElementById("u-" + hlUnit)?.scrollIntoView({ block: "center" });
    $("#rawBtn").onclick = () => openRaw(s.rawId, [], hlUnit);
    $("#v2Btn").onclick = () => { closeDrawer(); location.hash = `#/p/${PID}/v2?focus=${id}`; };
    $("#v1Btn").onclick = () => { closeDrawer(); location.hash = `#/p/${PID}/v1?sel=${id}`; };
    $("#markBtn").onclick = () => { toggleMark(id); drawerStack.pop(); openScene(id, [], hlUnit); render(true); };
    $("#drawerBody").querySelectorAll("[data-rel]").forEach((b) => (b.onclick = () => {
      store.d.relStatus[b.dataset.rel] = b.dataset.set; store.save(); drawerStack.pop(); openScene(id, [], hlUnit); render(true);
    }));
  }
  function openRaw(rawId, base = [], hlUnit = null) {
    const r = rawById[rawId];
    if (!r) return;
    if (base.length && !drawerStack.length) drawerStack = base.map((b) => ({ label: b.label, open: closeDrawer }));
    let text = esc(r.text);
    if (hlUnit && unitById[hlUnit]) {
      const u = esc(unitById[hlUnit].text);
      text = text.replace(u, `<mark>${u}</mark>`);
    }
    const sc = scenes.filter((s) => s.rawId === rawId);
    pushDrawer(`原記録 ${rawId}`, () => openRaw(rawId, [], hlUnit), `
      <h3>原記録 ${rawId}</h3>
      <div class="note">${esc(r.heading)}</div><div class="note">${esc(r.recorder)}</div>
      <div style="margin:6px 0"><span class="badge">${esc(r.recall)}</span> <span class="badge">原典</span></div>
      <div class="rawtext">${text}</div>
      <h4>この原記録から作られた場面</h4>${sc.map((s) => refChip({ type: "scene", id: s.id })).join(" ")}
      <p class="note">閲覧範囲（全文／抜粋／記録IDのみ）は未決事項 U-3。試作では全文を表示しています。</p>`);
  }

  // ---------- V1 renderer (F-3.1) ----------
  function renderTimeline(host, opts = {}) {
    const compact = !!opts.compact;
    host.innerHTML = "";
    const W = Math.max(compact ? (opts.minW || 520) : 900, host.clientWidth || 900);
    const left = compact ? 54 : 150, right = 16;
    const top = compact ? 22 : 74;
    const full = [t("1981-01-01"), t("2027-01-01")];
    const dom = (!compact && st.domain) || full;
    const x = (ms) => left + ((ms - dom[0]) / (dom[1] - dom[0])) * (W - left - right);
    const inDom = (ms) => ms >= dom[0] && ms <= dom[1];
    const qSet = st.focusQ ? questionScenes(st.focusQ) : null;
    const highlightSet = qSet || (st.theme ? new Set(scenes.filter((s) => s.themes.includes(st.theme)).map((s) => s.id)) : null);

    // nodes (scenes + practice events)
    const nodes = scenes.filter((s) => st.layers[s.primary] && inDom(t(s.date))).map((s) => ({
      id: s.id, s, layer: s.primary, cx: x(t(s.date)), r: compact ? Math.max(3, RADIUS[importanceLevel(s.id)] * 0.6) : RADIUS[importanceLevel(s.id)],
    }));
    for (const e of events()) {
      if (!st.layers.life || !inDom(t(e.date))) continue;
      nodes.push({ id: e.id, ev: e, layer: "life", cx: x(t(e.date)), r: compact ? 5 : 8 });
    }

    // beeswarm rows per lane
    const laneRows = {};
    for (const L of LAYERS) {
      const ns = nodes.filter((n) => n.layer === L.id).sort((a, b) => a.cx - b.cx);
      const rows = [];
      for (const n of ns) {
        let k = rows.findIndex((last) => n.cx - last >= n.r * 2 + 3);
        if (k < 0) { k = rows.length; rows.push(-1e9); }
        rows[k] = n.cx + n.r; n.row = k;
      }
      laneRows[L.id] = Math.max(1, rows.length);
    }
    const rowH = compact ? 11 : 26;
    const lanePad = compact ? 8 : 22;
    const laneTop = {}, laneH = {};
    let y = top;
    for (const L of LAYERS) {
      if (!st.layers[L.id]) continue;
      laneTop[L.id] = y;
      laneH[L.id] = laneRows[L.id] * rowH + lanePad * 2;
      y += laneH[L.id];
    }
    const H = y + (compact ? 18 : 34);
    for (const n of nodes) n.cy = laneTop[n.layer] + lanePad + rowH / 2 + n.row * rowH + (compact ? 0 : 4);
    const nodeById = by(nodes, "id");

    const root = svg("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: compact ? "img" : "group",
      "aria-label": compact ? "ライフストーリー全体概要の縮小図（病気・生活・社会制度の3レイヤ）" : "ライフストーリー全体概要（病気・生活・社会制度の3レイヤ）。出来事ごとにボタンがあり、Tab で順に移動できます。同じ内容は詳細版（V2）でも読めます" }, host);

    // lanes
    for (const L of LAYERS) {
      if (!st.layers[L.id]) continue;
      svg("rect", { x: left, y: laneTop[L.id], width: W - left - right, height: laneH[L.id], fill: `var(--l-${L.id})`, opacity: 0.05 }, root);
      svg("line", { x1: left, x2: W - right, y1: laneTop[L.id], y2: laneTop[L.id], class: "tick" }, root);
      const lbl = svg("text", { x: 8, y: laneTop[L.id] + (compact ? 12 : 20), class: "lane-label" }, root);
      lbl.textContent = L.name;
      if (!compact) { const sub = svg("text", { x: 8, y: laneTop[L.id] + 36 }, root); sub.textContent = L.sub; }
    }

    // year ticks + ages
    const y0 = new Date(dom[0]).getFullYear(), y1 = new Date(dom[1]).getFullYear();
    const span = y1 - y0;
    const stepY = span > 30 ? (W < 420 ? 10 : 5) : span > 12 ? 2 : 1;
    for (let yr = Math.ceil(y0 / stepY) * stepY; yr <= y1; yr += stepY) {
      const xx = x(t(`${yr}-01-01`));
      if (xx < left || xx > W - right) continue;
      svg("line", { x1: xx, x2: xx, y1: top - 4, y2: H - (compact ? 14 : 28), class: "tick" }, root);
      const tl = svg("text", { x: xx, y: H - (compact ? 3 : 16), "text-anchor": "middle" }, root);
      tl.textContent = compact ? `${yr}` : `${yr}`;
      if (!compact) { const al = svg("text", { x: xx, y: H - 3, "text-anchor": "middle", fill: "var(--muted)" }, root); al.textContent = `${yr - birthYear}歳`; }
    }

    // top strips: residence & record density (FR-3.1.5)
    if (!compact) {
      for (const p of S.places) {
        const a = Math.max(x(t(p.start)), left), b = Math.min(x(t(p.end)), W - right);
        if (b <= a) continue;
        const g = svg("g", {}, root);
        svg("rect", { x: a + 1, y: 6, width: b - a - 2, height: 20, rx: 4, fill: "var(--surface-2)", stroke: "var(--border)" }, g);
        const tx = svg("text", { x: a + 6, y: 20 }, g); tx.textContent = b - a > 60 ? `${p.name}（候補）` : p.name;
        g.addEventListener("mousemove", (e) => showTip(`<b>住まい: ${esc(p.name)}</b><br>${fmtDate(p.start)} 〜 ${fmtDate(p.end)}<br>根拠: ${p.evidence.join(", ")}（自動候補・要確認）`, e));
        g.addEventListener("mouseleave", hideTip);
      }
      const lab = svg("text", { x: 8, y: 20 }, root); lab.textContent = "住まい";
      const lab2 = svg("text", { x: 8, y: 52 }, root); lab2.textContent = "記録の量";
      const counts = {};
      for (const s of scenes) counts[yearOf(s.date)] = (counts[yearOf(s.date)] || 0) + 1;
      const maxC = Math.max(...Object.values(counts));
      for (let yr = y0; yr <= y1; yr++) {
        const c = counts[yr] || 0;
        const a = x(t(`${yr}-01-01`)), b = x(t(`${yr + 1}-01-01`));
        if (b < left || a > W - right) continue;
        const hh = c ? 4 + (c / maxC) * 22 : 2;
        const r = svg("rect", { x: Math.max(a, left) + 1, y: 58 - hh, width: Math.max(1, Math.min(b, W - right) - Math.max(a, left) - 2), height: hh, rx: 2, fill: c ? "var(--muted)" : "var(--grid)" }, root);
        r.addEventListener("mousemove", (e) => showTip(c ? `<b>${yr}年</b> 場面 ${c} 件` : `<b>${yr}年</b> 記録が少ない／無い（出来事が無かったとは限らない）`, e));
        r.addEventListener("mouseleave", hideTip);
      }
    }

    // multi-layer connectors + secondary markers (FR-3.1.2)
    const gConn = svg("g", {}, root);
    for (const n of nodes) {
      if (!n.s) continue;
      for (const l of n.s.layers) {
        if (l === n.layer || !st.layers[l]) continue;
        const my = laneTop[l] + (compact ? 4 : 10);
        svg("line", { x1: n.cx, x2: n.cx, y1: n.cy, y2: my, stroke: "var(--axis)", "stroke-width": 1, opacity: highlightSet && !highlightSet.has(n.id) ? 0.1 : 0.5 }, gConn);
        svg("rect", { x: n.cx - 2.5, y: my - 2.5, width: 5, height: 5, fill: `var(--l-${l})`, opacity: highlightSet && !highlightSet.has(n.id) ? 0.15 : 0.9 }, gConn);
      }
    }

    // relations (FR-3.1.3, FR-3.4)
    if (!compact) {
      const gRel = svg("g", { fill: "none" }, root);
      for (const r of S.relations) {
        if (r.type === "theme" ? r.theme !== st.theme : !st.relTypes[r.type]) continue;
        const a = nodeById[r.from], b = nodeById[r.to];
        if (!a || !b) continue;
        const stt = relStatus(r);
        if (stt === "棄却") continue;
        const dash = stt === "採用" ? null : "4 3";
        const dx = Math.abs(b.cx - a.cx);
        const lift = Math.min(70, 14 + dx * 0.25);
        const ymin = Math.min(a.cy, b.cy) - lift;
        const d = `M${a.cx},${a.cy} C${a.cx},${ymin} ${b.cx},${ymin} ${b.cx},${b.cy}`;
        const dim = highlightSet && !(highlightSet.has(r.from) || highlightSet.has(r.to));
        const g = svg("g", { opacity: dim ? 0.12 : 0.9 }, gRel);
        if (r.type === "institutional" && r.direction === "constrain") {
          svg("path", { d, stroke: "var(--ink-2)", "stroke-width": 5, "stroke-dasharray": dash }, g);
          svg("path", { d, stroke: "var(--surface)", "stroke-width": 2 }, g);
        } else if (r.type === "institutional") {
          svg("path", { d, stroke: "var(--ink-2)", "stroke-width": 3.5, "stroke-dasharray": dash }, g);
        } else {
          svg("path", { d, stroke: r.type === "theme" ? "var(--l-life)" : "var(--muted)", "stroke-width": 1.5, "stroke-dasharray": dash }, g);
        }
        const hit = svg("path", { d, stroke: "transparent", "stroke-width": 12, style: "cursor:help" }, g);
        hit.addEventListener("mousemove", (e) => showTip(`<b>${REL[r.type].name}</b>${r.direction ? `（${r.direction === "constrain" ? "制約した" : "可能にした"}：${esc(r.system)}）` : ""}<br>${esc(r.desc)}<br>${r.from} → ${r.to}<br>見方: ${esc(r.by)} ／ ${esc(r.confirm)} ／ 状態: ${esc(stt)}<br><span class="muted">関係の線は因果を意味しません</span>`, e));
        hit.addEventListener("mouseleave", hideTip);
      }
    }

    // nodes
    const gNodes = svg("g", {}, root);
    for (const n of nodes) {
      const dim = highlightSet && !highlightSet.has(n.id) && !n.ev;
      const g = svg("g", {
        class: "node" + (dim ? " dim" : ""), transform: `translate(${n.cx},${n.cy})`,
        tabindex: compact || n.ev ? null : 0, role: compact || n.ev ? null : "button",
        "aria-label": compact ? null : nodeLabel(n), "data-node": n.id,
      }, gNodes);
      if (!compact) svg("circle", { r: Math.max(12, n.r + 4), fill: "transparent" }, g);
      const col = `var(--l-${n.layer})`;
      if (n.s?.dateRange && !compact) {
        const a = x(t(n.s.dateRange[0])) - n.cx, b = x(t(n.s.dateRange[1])) - n.cx;
        svg("rect", { x: a, y: -3, width: Math.max(4, b - a), height: 6, rx: 3, fill: col, opacity: 0.25 }, g);
      }
      if (n.ev) {
        const r = n.r;
        const pts = Array.from({ length: 10 }, (_, i) => { const a = (Math.PI / 5) * i - Math.PI / 2; const rr = i % 2 ? r * 0.45 : r; return `${(rr * Math.cos(a)).toFixed(1)},${(rr * Math.sin(a)).toFixed(1)}`; }).join(" ");
        svg("polygon", { points: pts, fill: n.ev.stopped ? "var(--surface)" : "var(--ink)", stroke: "var(--ink)", "stroke-width": 1.5 }, g);
      } else {
        const s = n.s, r = n.r;
        const edge = n.layer === "institution" ? "var(--l-institution-ink)" : col;
        const common = { fill: s.kind === "family" ? "var(--surface)" : col, stroke: s.kind === "family" || n.layer === "institution" ? edge : "var(--surface)", "stroke-width": s.kind === "family" ? 2.5 : 1.5 };
        if (s.kind === "medical") svg("rect", { x: -r, y: -r, width: r * 2, height: r * 2, rx: 2.5, ...common }, g);
        else if (s.kind === "consult") svg("polygon", { points: `0,${-r * 1.15} ${r * 1.1},${r * 0.8} ${-r * 1.1},${r * 0.8}`, ...common }, g);
        else svg("circle", { r, ...common }, g);
        if (importanceLevel(s.id) === 4) svg("circle", { r: r + 3.5, fill: "none", stroke: "var(--ink)", "stroke-width": 1.5 }, g);
        if (s.personVoice && !compact) svg("circle", { r: 2.2, fill: s.kind === "family" ? col : "var(--surface)" }, g);
        if (s.restraint) svg("rect", { x: -3, y: -r - 9, width: 6, height: 6, transform: `rotate(45 0 ${-r - 6})`, fill: "var(--ink)" }, g);
        if (st.selected === s.id) svg("circle", { r: r + 6, class: "sel-ring" }, g);
      }
      if (compact) continue;
      g.addEventListener("mousemove", (e) => showTip(nodeTip(n), e));
      g.addEventListener("mouseleave", hideTip);
      g.addEventListener("click", (e) => { e.stopPropagation(); hideTip(); if (n.ev) return; st.selected = n.id; opts.onSelect?.(n.id); });
      g.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && n.s) { e.preventDefault(); st.selected = n.id; opts.onSelect?.(n.id); } });
      g.addEventListener("focus", () => { svg("circle", { r: n.r + 6, class: "focus-ring" }, g); showTipAt(nodeTip(n), g); });
      g.addEventListener("blur", () => { g.querySelector(".focus-ring")?.remove(); hideTipNow(); });
    }

    // brush to zoom (FR-3.1.7)
    if (!compact) {
      let start = null; let band = null;
      const pt = (e) => { const b = root.getBoundingClientRect(); return e.clientX - b.left; };
      root.addEventListener("mousedown", (e) => {
        if (e.target.closest(".node")) return;
        start = pt(e); band = svg("rect", { x: start, y: top, width: 0, height: H - top - 30, fill: "var(--accent)", opacity: 0.12 }, root);
      });
      root.addEventListener("mousemove", (e) => { if (start === null) return; const cur = pt(e); band.setAttribute("x", Math.min(cur, start)); band.setAttribute("width", Math.abs(cur - start)); });
      const end = (e) => {
        if (start === null) return;
        const cur = pt(e); const a = Math.min(cur, start), b = Math.max(cur, start); start = null; band.remove();
        if (b - a < 12) return;
        const inv = (px) => dom[0] + ((px - left) / (W - left - right)) * (dom[1] - dom[0]);
        st.domain = [inv(Math.max(a, left)), inv(Math.min(b, W - right))];
        opts.onZoom?.();
      };
      root.addEventListener("mouseup", end);
      root.addEventListener("mouseleave", () => { if (start !== null) { start = null; band.remove(); } });
    }
    root.__geo = { x, inv: (px) => dom[0] + ((px - left) / (W - left - right)) * (dom[1] - dom[0]), top, H, left, right, W };
    return root;
  }

  function nodeLabel(n) {
    if (n.ev) return `実践の出来事 ${n.ev.id} ${fmtDate(n.ev.date)}`;
    const s = n.s, ms = marksFor(s.id);
    return `${fmtDate(s.date)} ${yearOf(s.date) - birthYear}歳ごろ ${s.id}。${s.layers.map((l) => layerName[l]).join("・")}レイヤ。${KIND_LABEL[s.kind]}。` +
      `${clip(s.text, 40)}。大切さの印 ${ms.length ? ms.map((m) => m.role).join("・") : "未評価"}${s.restraint ? "。権利制限的対応を含む" : ""}`;
  }
  function nodeTip(n) {
    if (n.ev) {
      const e = n.ev;
      return `<b>★ 実践の出来事 ${esc(e.id)}</b> ${fmtDate(e.date)}${e.stopped ? " <b>（中止）</b>" : ""}<br>変更: ${esc(e.change)}<br>本人が表したこと: ${esc(e.expression)}<br><span class="muted">このブラウザで記録した試作データ</span>`;
    }
    const s = n.s;
    const ms = marksFor(s.id);
    const who = ms.length ? ms.map((m) => m.role).join("・") : "未評価";
    return `<b>${s.id}</b> ${fmtDate(s.date)}（${yearOf(s.date) - birthYear}歳ごろ） ${esc(s.certainty)}<br>
      ${esc(s.heading.replace(/^\S+\s+\S+\s+/, ""))} ／ ${esc(KIND_LABEL[s.kind])}<br>
      ${esc(clip(s.text, 90))}<br>
      レイヤ: ${s.layers.map((l) => layerName[l] + (l === s.primary ? "（主）" : "")).join("・")} <span class="muted">候補</span><br>
      大切さの印: ${esc(who)}${s.personVoice ? "<br>● 本人の発話候補あり" : ""}${s.restraint ? "<br>◆ 権利制限的対応を含む" : ""}`;
  }

  function legendHtml() {
    const shape = (k) => {
      const c = "var(--ink-2)";
      if (k === "medical") return `<svg width="16" height="16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" fill="${c}"/></svg>`;
      if (k === "consult") return `<svg width="16" height="16" aria-hidden="true"><polygon points="8,2 14,13 2,13" fill="${c}"/></svg>`;
      if (k === "family") return `<svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="${c}" stroke-width="2.5"/></svg>`;
      return `<svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="${c}"/></svg>`;
    };
    const size = (r, ring) => `<svg width="30" height="30" aria-hidden="true"><circle cx="15" cy="15" r="${r}" fill="var(--muted)"/>${ring ? `<circle cx="15" cy="15" r="${r + 3}" fill="none" stroke="var(--ink)" stroke-width="1.5"/>` : ""}</svg>`;
    const line = (attrs) => `<svg width="40" height="12" aria-hidden="true"><path d="M2,6 L38,6" ${attrs}/></svg>`;
    return `<div class="legend card">
      <b>読み方</b>
      <p class="note">横は時間（年・年齢）。出来事を3つのレイヤに置き、関係を曲線で結んでいます。</p>
      <h4>色＝レイヤ</h4>
      ${LAYERS.map((l) => `<div class="li"><span class="layer-dot ld-${l.id}"></span><span><b>${l.name}</b><br><span class="muted">${l.sub}</span></span></div>`).join("")}
      <div class="li"><svg width="16" height="16" aria-hidden="true"><line x1="8" y1="2" x2="8" y2="12" stroke="var(--axis)"/><rect x="5.5" y="1" width="5" height="5" fill="var(--muted)"/></svg>ほかのレイヤにもまたがる</div>
      <h4>形＝記録の種類</h4>
      ${Object.entries(KIND_LABEL).map(([k, v]) => `<div class="li">${shape(k)}${v}</div>`).join("")}
      <div class="li"><svg width="16" height="16" aria-hidden="true"><polygon points="8,1 10,6 15,6 11,9 12.5,14 8,11 3.5,14 5,9 1,6 6,6" fill="var(--ink)"/></svg>実践の出来事（1.5回目）</div>
      <h4>大きさ＝人が付けた「大切さの印」</h4>
      <div class="li">${size(12.5, true)}本人が付けた</div>
      <div class="li">${size(10)}複数人が付けた</div>
      <div class="li">${size(7.5)}1人が付けた</div>
      <div class="li">${size(5)}未評価</div>
      <p class="note">大きさはシステムが算出したものではありません。</p>
      <h4>印</h4>
      <div class="li"><svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="var(--muted)"/><circle cx="8" cy="8" r="2" fill="var(--surface)"/></svg>本人の発話候補あり</div>
      <div class="li"><svg width="16" height="16" aria-hidden="true"><rect x="5" y="5" width="6" height="6" transform="rotate(45 8 8)" fill="var(--ink)"/></svg>権利制限的対応（身体拘束等）</div>
      <h4>関係の線（因果ではありません）</h4>
      <div class="li">${line('stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3"')}候補（AI・規則）</div>
      <div class="li">${line('stroke="var(--muted)" stroke-width="1.5"')}人が採用した</div>
      <div class="li"><svg width="40" height="12" aria-hidden="true"><path d="M2,6 L38,6" stroke="var(--ink-2)" stroke-width="5"/><path d="M2,6 L38,6" stroke="var(--surface)" stroke-width="2"/></svg>制度による対応：制約した</div>
      <div class="li">${line('stroke="var(--ink-2)" stroke-width="3.5"')}制度による対応：可能にした</div>
      <div class="li">${line('stroke="var(--l-life)" stroke-width="1.5" stroke-dasharray="4 3"')}同じ人・もの・テーマ</div>
    </div>`;
  }

  // ---------- pages ----------
  const app = $("#app");
  const crumbs = $("#crumbs");

  function cycleState() {
    // seed: 1回目 = 模擬会議 M-C1008-01, 0回目 = 模擬（シード取込み）
    const evs = events();
    return { done: ["0回目", "1回目"], now: evs.length ? "1.5回目" : "1.5回目" };
  }
  function stepperHtml() {
    const c = cycleState();
    return `<div class="stepper">${PHASES.map((p) => `<span class="step ${c.done.includes(p) ? "done" : p === c.now ? "now" : ""}"><i></i>${p}</span>`).join("")}</div>`;
  }
  const pendingCands = () => S.candidates.filter((c) => /要確認|未検証/.test(c.status || "要確認")).length;
  const pendingAfterglow = () => events().filter((e) => !e.afterPerson && !e.afterSupporter).length;

  function renderHome() {
    if (role() === "本人") { location.replace(`#/p/${PID}/v3`); return; }
    crumbs.innerHTML = "ホーム";
    const info = M.info;
    app.innerHTML = `
      <h1 class="page-title">ホーム</h1>
      ${role() === "本人" ? `<p class="card"><a class="btn primary big" href="#/p/${PID}/v3">わたしの あゆみ を ひらく</a> <span class="note">本人の立場では、本人向け絵巻物（V3）を開きます（FR-0.1.5）。</span></p>` : ""}
      <h2 class="section-title">今後の予定</h2>
      <div class="card"><div class="note">会議カレンダー（試作）: 次回確認日は模擬会議で「未設定」。2回目は初回から2〜4週後が目安です。</div>
        <div style="margin-top:6px">${esc(info["会議ID"])} 1回目（模擬） — 焦点 ${esc(info["場面ID"])}「${esc(info["主題"])}」 <span class="badge mock">模擬</span></div></div>
      <h2 class="section-title">担当事例</h2>
      <div class="home-grid">
        <a class="card case-card" id="caseP001" href="#/p/${PID}">
          <h3>P001 <span class="badge mock">シード・架空</span></h3>
          ${stepperHtml()}
          <dl class="kv">
            <dt>現在</dt><dd>1.5回目（日常での試行）</dd>
            <dt>次の会議</dt><dd>2回目：未設定 <span class="muted">（目安 初回から2〜4週後）</span></dd>
            <dt>余韻の追記待ち</dt><dd>${pendingAfterglow()} 件</dd>
            <dt>試行の中止</dt><dd>${events().filter((e) => e.stopped).length} 件</dd>
            <dt>意思確認の期限</dt><dd class="muted">未登録</dd>
            <dt>未判定の候補</dt><dd>${pendingCands()} 件</dd>
          </dl>
        </a>
      </div>
      <p class="note">並び順は次の予定日順です。本人の状態の良し悪しで並べ替えたり色分けしたりはしません（P-7）。</p>`;
  }

  // ---------- dashboard (F-0.2): A4 one-page overview + detail pages ----------
  const QN = ["", "①", "②", "③"];
  const DETAILS = [
    { id: "questions", name: "② 3つの問い" },
    { id: "reflection", name: "③ 振り返り" },
    { id: "practice", name: "④ 実践結果の集約" },
    { id: "awareness", name: "⑤ 気づき・未確認" },
    { id: "next", name: "⑥ 次にやること" },
  ];
  const detailHref = (id, anchor = "") => `#/p/${PID}/d/${id}${anchor ? `?at=${anchor}` : ""}`;

  function dashCtx() {
    const sum = by(M.summary, "項目ID");
    const qs = M.questions;
    const qStatus = (n) => store.d.qStatus[n] || (qs.find((q) => +q["問ID"] === n)["入力種別"] === "模擬編集" ? "編集済" : "未レビュー");
    const hyps = (sum["F-uncertainty"]["内容"].match(/[①②③④⑤]([^①②③④⑤]+?)(?=\s*[①②③④⑤]|。|$)/g) || []).map((h) => h.trim());
    const evs = events();
    const reactions = Object.values(store.d.personReactions || {});
    const recent = new Set(scenes.filter((x) => yearOf(x.date) >= 2019).map((x) => x.id));
    const vp = S.viewpoints.map((v) => ({ ...v, n: S.evidence.filter((e) => e.viewpoint === v.id && recent.has(e.sceneId)).length }));
    return { sum, qs, qStatus, hyps, evs, reactions, vp, plans: store.d.plans || [] };
  }
  const nextDateText = (sum) => (sum["F-nextDate"]["内容"] && sum["F-nextDate"]["内容"] !== "None" ? sum["F-nextDate"]["内容"] : "未設定");

  // --- full panels (detail pages) ---
  function questionsFull(c) {
    return c.qs.map((q) => {
      const n = +q["問ID"];
      const refs = questionRefs(n);
      const cnt = M.statements.filter((x) => +x["問い番号"] === n).length;
      return `<div class="qcard ${st.focusQ === n ? "active" : ""}" data-q="${n}" id="q${n}">
        <div class="qtype"><b>${QN[n]} ${esc(q["種類"])}</b><span class="badge">${c.qStatus(n)}</span><span class="badge mock">提案者: 模擬</span><span class="muted">発言 ${cnt}件</span></div>
        <p>${esc(q["場面別の問い"])}</p>
        <div class="note">${esc(q["設計上の目的"])}</div>
        <div class="refs">根拠: ${refs.map((r) => refChip(r).replace("<span ", `<span data-crumb="問い${n}" `)).join("")}</div>
        <div style="margin-top:6px"><button class="btn small" data-qset="${n}" data-v="採用">採用</button> <button class="btn small" data-qset="${n}" data-v="却下">却下</button> <button class="btn small" data-qfocus="${n}" aria-pressed="${st.focusQ === n}">ライフストーリーで強調</button></div>
      </div>`;
    }).join("") + `<p class="note">問いは正解へ誘導しません。採否と編集の履歴を残します（F-4）。</p>`;
  }
  function reflectionFull(c) {
    const { sum, hyps, evs } = c;
    return `
      <div class="box"><h3 class="box-h">確認できる事実 <span class="badge">原記録にもとづく</span> <span class="badge mock">模擬整理</span></h3>${esc(sum["F-confirmed"]["内容"])}</div>
      <h3 class="sub-h">仮説（併存させて保持・多数決で決めない）</h3>
      ${hyps.map((h, i) => `<div class="hyp"><b>H${i + 1}</b><span style="flex:1">${esc(h.replace(/^[①②③④⑤]/, ""))}</span><span class="badge">保留</span></div>`).join("")}
      <div class="note" style="margin-top:4px">${esc(sum["F-uncertainty"]["内容"].split("。").slice(1).join("。"))}</div>
      <div class="two-col" style="margin-top:10px" id="afterglow">
        <div class="box"><h3 class="box-h">余韻（本人のその後の表現）</h3>${evs.filter((e) => e.afterPerson).map((e) => `<div>${fmtDate(e.date)} ${esc(e.afterPerson)}</div>`).join("") || '<div class="empty">まだ記録がありません</div>'}</div>
        <div class="box"><h3 class="box-h">余韻（支援者自身）</h3>${evs.filter((e) => e.afterSupporter).map((e) => `<div>${fmtDate(e.date)} ${esc(e.afterSupporter)}</div>`).join("") || '<div class="empty">まだ記録がありません</div>'}</div>
      </div>
      <div class="box" style="margin-top:10px" id="person"><h3 class="box-h">本人の振り返り（様式E・V3 の反応）</h3>${personReactionsHtml()}</div>
      <h3 class="sub-h" id="statements">会議での発言 ${M.statements.length}件（問い別） <span class="badge mock">模擬</span></h3>
      ${[1, 2, 3].map((n) => `<div class="note" style="margin-top:8px"><b>問い${QN[n]}</b></div>` + M.statements.filter((x) => +x["問い番号"] === n).map((x) => {
        const pi = M.participants.findIndex((pp) => pp["参加者ID"] === x["参加者ID"]);
        return `<div class="stmt"><span class="pdot" style="background:${PART_COLORS[pi] || "var(--muted)"}" aria-hidden="true"></span><div><div class="who">${esc(x["氏名"])}（${esc(participantById[x["参加者ID"]]?.["議論上の視点"] || x["役割"])}）・${esc(x["発言の種類"])}</div>${esc(x["発言内容"])}<div class="refs" style="margin-top:2px">${parseRefs(x["根拠・未確認事項"]).map((r) => refChip(r).replace("<span ", `<span data-crumb="発言${x["発言ID"]}" `)).join("")} <span class="note">${esc(x["根拠・未確認事項"])}</span></div></div></div>`;
      }).join("")).join("")}`;
  }
  function practiceFull(c) {
    const { sum, evs } = c;
    return `
      ${c.plans.map((pl) => `<div class="box" style="margin-bottom:8px"><h3 class="box-h">試行計画 ${esc(pl.id)} <span class="badge ok">会議 ${esc(pl.meeting)} で作成</span></h3>
        <div><b>何を何から何へ:</b> ${esc(pl.change)}</div><div><b>担当・場面:</b> ${esc(pl.owner)} ／ ${esc(pl.scene)} ／ ${esc(pl.when)}</div>
        <div><b>止める条件:</b> ${esc(pl.stop)}</div><div class="note">余韻の確認: ${esc(pl.afterglowDate || "未設定")} ／ 本人の意思確認: ${esc(pl.consent)}</div></div>`).join("")}
      <div class="box"><h3 class="box-h">試行計画 P1 <span class="badge mock">模擬案</span></h3>${esc(sum["F-nextAction"]["内容"])}
        <div class="note" style="margin-top:4px">本人と確かめる方法: ${esc(sum["F-askPerson"]["内容"])}</div></div>
      <h3 class="sub-h">計画と実践（実施 ${evs.filter((e) => !e.stopped).length} ／ 中止 ${evs.filter((e) => e.stopped).length}）</h3>
      ${evs.length ? evs.map((e) => `<div class="evt-item"><b>${esc(e.id)}</b> ${fmtDate(e.date)} ${e.stopped ? '<span class="badge stop">中止</span>' : '<span class="badge">実施</span>'} <span class="badge">試作入力</span>
          <div>変更: ${esc(e.change)}</div><div>本人が表したこと（原文）: ${esc(e.expression)}</div>
          ${e.afterPerson || e.afterSupporter ? "" : `<button class="btn small" data-after="${e.id}">余韻を追記</button>`}</div>`).join("") : '<div class="empty">1.5回目の出来事はまだ記録されていません。</div>'}
      <details style="margin-top:8px" id="record"><summary>1.5回目の出来事を記録する（試作・様式C-1）</summary>
        <form class="evt" id="evtForm">
          <label>出来事の日付<input type="date" name="date" value="2026-11-05" required></label>
          <label>支援・環境を何から何へ変えたか<input name="change" required placeholder="例: 夕方の配膳前に、写真帳と休息を選べる形で提示した"></label>
          <label>本人が表したこと（原文：言葉・視線・身振り）<textarea name="expression" rows="2" required placeholder="印象語ではなく、示した言葉や動きをそのまま"></textarea></label>
          <label><span><input type="checkbox" name="stopped"> 拒否・苦痛があり中止した</span></label>
          <button class="btn primary" type="submit">記録する</button>
        </form>
      </details>
      <h3 class="sub-h">4観点 出発点 → 現在 <span class="badge">スコアなし</span></h3>
      <table class="plain"><thead><tr><th scope="col">観点</th><th scope="col">出発点</th><th scope="col">現在</th><th scope="col">根拠・未確認</th></tr></thead><tbody>
        ${["安心", "表現", "選択", "拡大"].map((a) => `<tr><th scope="row">${a}</th><td class="muted">未記録</td><td class="muted">2回目で記入</td><td class="muted">—</td></tr>`).join("")}
      </tbody></table>
      <div class="note" style="margin-top:6px">観察指標（模擬）: ${esc(sum["F-indicator"]["内容"])}</div>
      <h3 class="sub-h">What-if（3つ目の問いの検討） <span class="badge mock">模擬</span></h3>
      ${M.whatif.map((w) => `<div class="hyp"><b>${esc(w["観点"])}</b><span style="flex:1">${esc(w["内容"])}</span><span class="badge">${esc(w["検証状況"])}</span></div>`).join("")}`;
  }
  function nextFull(c) {
    const { sum } = c;
    return `<table class="plain"><tbody>
      <tr><th scope="row">担当</th><td>${esc(sum["F-owner"]["内容"])}</td></tr>
      <tr><th scope="row">次回確認日</th><td>${esc(nextDateText(sum))} <span class="muted">（目安: 初回から2〜4週後）</span></td></tr>
      <tr><th scope="row">次の実践・記録</th><td>${esc(sum["F-nextAction"]["内容"])}</td></tr>
      <tr><th scope="row">持ち越し</th><td>${esc(sum["F-carry"]["内容"])}</td></tr>
      <tr><th scope="row">リマインド</th><td>余韻の追記待ち ${pendingAfterglow()}件 ／ 未判定の候補 ${pendingCands()}件</td></tr>
    </tbody></table>`;
  }

  // --- compact tiles (A4 overview) ---
  const kv = (rows) => `<dl class="tile-kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  const tile = (cls, title, id, body, extra = "") =>
    `<section class="panel tile ${cls}" aria-labelledby="t-${id}"><div class="tile-h"><h2 id="t-${id}">${title}</h2>${extra}<a class="more" href="${detailHref(id)}">詳しく<span class="sr-only">（${title}）</span> →</a></div>${body}</section>`;

  function renderDashboard() {
    crumbs.innerHTML = `<a href="#/">ホーム</a> › P001 ケース会議ダッシュボード`;
    const info = M.info;
    const c = dashCtx();
    const { sum, evs } = c;
    const low = c.vp.reduce((a, b) => (b.n < a.n ? b : a));
    const rCount = c.reactions.reduce((m, r) => ((m[r.value] = (m[r.value] || 0) + 1), m), {});
    const pImp = Object.values(store.d.marks).filter((ms) => ms.some((m) => m.role === "本人")).length;
    const stopped = evs.filter((e) => e.stopped).length;

    app.innerHTML = `
      <div class="dash-a4">
      <div class="dash-head compact">
        <h1>P001 ケース会議ダッシュボード</h1>
        ${stepperHtml()}
        <span class="note">焦点 <span class="chip" role="button" tabindex="0" data-ref-type="scene" data-ref-id="${info["場面ID"]}" data-crumb="ダッシュボード">${info["場面ID"]} ${esc(info["主題"])}</span></span>
        <span class="badge mock">模擬データを含む</span>
        <span style="flex:1"></span>
        <a class="btn small no-print" href="#/p/${PID}/v3">本人向け（V3）</a>
        <a class="btn small primary no-print" id="startMeeting" href="#/p/${PID}/meeting">会議を始める</a>
        <button class="btn small no-print" id="printBtn">A4で印刷</button>
      </div>

      <section class="panel story-strip" aria-labelledby="t-story">
        <div class="tile-h"><h2 id="t-story">① ライフストーリー</h2>
          <span class="note">${LAYERS.map((l) => `<span class="layer-dot ld-${l.id}" aria-hidden="true"></span> ${l.name}`).join("　")}　★ 実践 ${evs.length}件${st.focusQ ? `　問い${QN[st.focusQ]}の根拠を強調中` : ""}</span>
          <span style="flex:1"></span>
          <a class="more" href="#/p/${PID}/v1">全体概要（V1）→</a>
          <a class="more" href="#/p/${PID}/v2${st.focusQ ? `?focus=${M.questions[st.focusQ - 1]["参照場面ID"]}` : ""}">詳細版（V2）→</a></div>
        <div class="viz mini-viz" id="miniViz"></div>
      </section>

      <section class="panel q-strip" aria-labelledby="t-questions">
        <div class="tile-h"><h2 id="t-questions">② 3つの問い</h2><span class="badge mock">模擬</span><a class="more" href="${detailHref("questions")}">詳しく<span class="sr-only">（3つの問い）</span> →</a></div>
        <div class="q-row">
          ${c.qs.map((q) => {
            const n = +q["問ID"];
            const nRefs = questionRefs(n).length;
            const cnt = M.statements.filter((x) => +x["問い番号"] === n).length;
            return `<article class="qmini ${st.focusQ === n ? "active" : ""}">
              <div class="qtype"><b>${QN[n]} ${esc(q["種類"].replace("ための問い", "問い"))}</b><span class="badge">${c.qStatus(n)}</span></div>
              <p class="clamp3">${esc(q["場面別の問い"])}</p>
              <div class="qmini-foot"><span class="muted">根拠 ${nRefs}・発言 ${cnt}</span><span style="flex:1"></span>
                <button class="btn small" data-qfocus="${n}" aria-pressed="${st.focusQ === n}">強調</button>
                <a class="btn small" href="${detailHref("questions", "q" + n)}">開く<span class="sr-only">（問い${QN[n]}）</span></a></div>
            </article>`;
          }).join("")}
        </div>
      </section>

      <div class="tile-row">
        ${tile("t-rev", "③ 振り返り", "reflection", kv([
          ["仮説", `${c.hyps.length}件 <span class="muted">（保留 ${c.hyps.length}）</span>`],
          ["余韻", `本人 ${evs.filter((e) => e.afterPerson).length}・支援者 ${evs.filter((e) => e.afterSupporter).length}件`],
          ["本人の反応", c.reactions.length ? Object.entries(rCount).map(([k, v]) => `${esc(k)} ${v}`).join("・") + (pImp ? `・たいせつ ${pImp}` : "") : '<span class="muted">まだなし</span>'],
          ["会議の見方", `${M.statements.length}件`],
        ]))}
        ${tile("t-prac", "④ 実践結果の集約", "practice", kv([
          ["試行計画", `${c.plans.length + 1}件 <span class="muted">（P1 模擬案${c.plans.length ? `＋${c.plans.length}` : ""}）</span>`],
          ["実践", `実施 ${evs.length - stopped}・中止 ${stopped}${stopped ? ' <span class="badge stop">中止あり</span>' : ""}`],
          ["余韻待ち", `${pendingAfterglow()}件`],
          ["4観点", '<span class="muted">未記録（2回目で記入）</span>'],
        ]), `<a class="more" href="${detailHref("practice", "record")}">＋記録</a>`)}
        ${tile("t-aware", "⑤ 気づき・未確認", "awareness", kv([
          ["未判定の候補", `${pendingCands()}件`],
          ["意思表出候補", `${S.candidates.filter((x) => x.type === "intent").length}件 <span class="muted">意味は未確定</span>`],
          ["少ない観点", `${esc(low.id)} ${esc(low.name)}（${low.n}件）`],
        ]) + `<p class="clamp2 note">確かめてみませんか：${esc(low.question)}</p>`)}
        ${tile("t-next", "⑥ 次にやること", "next", kv([
          ["次回確認日", esc(nextDateText(sum))],
          ["担当", `<span class="clamp2">${esc(sum["F-owner"]["内容"].replace(/^模擬担当：/, ""))}</span>`],
          ["持ち越し", `<span class="clamp2">${esc(sum["F-carry"]["内容"])}</span>`],
        ]))}
      </div>
      </div>`;

    renderTimeline($("#miniViz"), { compact: true, minW: 600 });
    $("#miniViz").onclick = () => (location.hash = `#/p/${PID}/v1`);
    $("#printBtn").onclick = () => window.print();
    bindPanelEvents();
  }

  function renderDetail(kind, params) {
    const d = DETAILS.find((x) => x.id === kind) || DETAILS[0];
    crumbs.innerHTML = `<a href="#/">ホーム</a> › <a href="#/p/${PID}">P001 ダッシュボード</a> › ${esc(d.name)}`;
    const c = dashCtx();
    const body = { questions: questionsFull, reflection: reflectionFull, practice: practiceFull, awareness: () => awarenessHtml(), next: nextFull }[d.id](c);
    app.innerHTML = `
      <div class="detail-page">
        <div class="dash-head compact">
          <h1>P001 ${esc(d.name)}</h1>
          <span style="flex:1"></span>
          <a class="btn small" href="#/p/${PID}">← ダッシュボードへ戻る</a>
        </div>
        <nav class="detail-tabs" aria-label="ダッシュボードの詳細ページ">
          <ul>${DETAILS.map((x) => `<li><a href="${detailHref(x.id)}" ${x.id === d.id ? 'aria-current="page"' : ""}>${esc(x.name)}</a></li>`).join("")}</ul>
        </nav>
        <section class="panel detail-body">${body}</section>
      </div>`;
    bindPanelEvents();
    if (params.at) { const el = document.getElementById(params.at); if (el) { if (el.tagName === "DETAILS") el.open = true; el.scrollIntoView({ block: "start" }); (el.querySelector("summary, button, input") || el).focus?.({ preventScroll: true }); } }
    document.title = `P001 ${d.name} — TOMONI（試作）`;
  }

  function bindPanelEvents() {
    app.querySelectorAll("[data-qfocus]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const n = +b.dataset.qfocus; st.focusQ = st.focusQ === n ? null : n; render(true); app.querySelector(`[data-qfocus="${n}"]`)?.focus(); announce(st.focusQ ? `問い${QN[n]}の根拠をライフストーリーで強調しています` : "強調を解除しました"); }));
    app.querySelectorAll("[data-qset]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); store.d.qStatus[b.dataset.qset] = b.dataset.v; store.save(); render(true); app.querySelector(`[data-qset="${b.dataset.qset}"][data-v="${b.dataset.v}"]`)?.focus(); announce(`問い${QN[b.dataset.qset]}を「${b.dataset.v}」にしました`); }));
    app.querySelectorAll("[data-after]").forEach((b) => (b.onclick = () => afterglowForm(b.dataset.after)));
    app.querySelectorAll("[data-vp]").forEach((r) => {
      r.onmousemove = (e) => showTip(r.dataset.tip, e);
      r.onmouseleave = hideTip;
    });
    const f = $("#evtForm");
    if (f) f.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      store.d.events.push({
        id: `E${store.d.events.length + 1}`, date: fd.get("date"), change: fd.get("change"),
        expression: fd.get("expression"), stopped: !!fd.get("stopped"), plan: "P1", at: new Date().toISOString(),
      });
      store.save(); render(true); announce("1.5回目の出来事を記録しました");
    };
  }

  function personReactionsHtml() {
    const rs = Object.entries(store.d.personReactions || {});
    if (!rs.length) return '<div class="empty">まだ回答がありません。「いまは みない／こたえない」も回答として尊重します。</div>';
    return rs.map(([id, r]) => `<div><span class="chip" role="button" tabindex="0" data-ref-type="scene" data-ref-id="${id}">${id}</span> 本人: <b>${esc(r.value)}</b>
      <span class="note">${esc(fmtDate(r.at.slice(0, 10)))}・手伝った人 ${esc(r.helper || "なし")}・方法 ${esc(r.method || "—")}</span></div>`).join("") +
      '<p class="note">本人の回答は、試行や研究記録への同意の代わりにはしません（FR-10.5）。</p>';
  }
  function afterglowForm(id) {
    const e = store.d.events.find((x) => x.id === id);
    pushDrawer(`余韻 ${id}`, () => afterglowForm(id), `
      <h3>余韻の追記（様式C-2）${esc(id)}</h3>
      <p class="note">本人のその後の表現と、支援者自身の余韻を分けて記録します。支援者の余韻を本人の感覚の証拠として扱いません。</p>
      <form class="evt" id="afterForm">
        <label>その後、本人が表したこと・生活に見られたこと<textarea name="afterPerson" rows="3"></textarea></label>
        <label>支援者自身に残った余韻（驚き・安心・戸惑い・違和感）<textarea name="afterSupporter" rows="3"></textarea></label>
        <button class="btn primary">保存</button>
      </form>`);
    $("#afterForm").onsubmit = (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      e.afterPerson = f.get("afterPerson"); e.afterSupporter = f.get("afterSupporter");
      store.save(); drawer.hidden = true; drawerStack = []; render();
    };
  }

  function awarenessHtml() {
    const cnt = {};
    for (const c of S.candidates) cnt[c.type] = (cnt[c.type] || 0) + 1;
    const focusScene = M.info["場面ID"];
    const recent = new Set(scenes.filter((s) => yearOf(s.date) >= 2019).map((s) => s.id));
    const vp = S.viewpoints.map((v) => ({ ...v, n: S.evidence.filter((e) => e.viewpoint === v.id && recent.has(e.sceneId)).length }));
    const max = Math.max(...vp.map((v) => v.n), 1);
    const low = vp.reduce((a, b) => (b.n < a.n ? b : a));
    const unconfirmedIntent = S.candidates.filter((c) => c.type === "intent").length;
    return `
      <div class="note">自動抽出の候補（すべて未検証）: ${Object.entries(cnt).map(([k, v]) => `${CAND_LABEL[k]} ${v}`).join("・")}</div>
      <div class="note">意思表出の候補 ${unconfirmedIntent} 件は、意味・意思が未確定です（本人と確かめる対象）</div>
      <h4 class="note" style="margin:10px 0 4px">見立て観点の記述（2019年以降の記録）</h4>
      <div class="bars">${vp.map((v) => `<div class="row" data-vp="${v.id}" data-tip="${esc(`<b>${esc(v.id)} ${esc(v.name)}</b><br>${esc(v.definition)}<br>省察質問: ${esc(v.question)}<br><span class='muted'>限界: ${esc(v.limit)}</span>`)}"><span>${v.id} ${esc(v.name)}</span><span class="track"><span class="fill" style="width:${(v.n / max) * 100}%"></span></span><span class="val">${v.n}</span></div>`).join("")}</div>
      <p class="note">件数は技能の高低・因果の証明ではありません。省察の手がかりです。</p>
      <div class="box" style="margin-top:6px"><h4>確かめてみませんか（${low.id} ${esc(low.name)}の記述が少ない）</h4>${esc(low.question)}
        <div class="refs" style="margin-top:4px">${refChip({ type: "scene", id: focusScene })}</div></div>`;
  }

  const BASIC_REL = ["transition", "institutional", "participant"];
  function shortLegendHtml() {
    const sh = (k) => ({ support: "●", family: "○", medical: "■", consult: "▲" }[k]);
    return `<div class="legend-short" role="note" aria-label="凡例（短縮版）">
      ${LAYERS.map((l) => `<span><span class="layer-dot ld-${l.id}" aria-hidden="true"></span>${l.name}</span>`).join("")}
      <span class="sep" aria-hidden="true">｜</span>
      ${Object.entries(KIND_LABEL).map(([k, v]) => `<span><span aria-hidden="true">${sh(k)}</span> ${v.replace("の記録", "")}</span>`).join("")}
      <span class="sep" aria-hidden="true">｜</span>
      <span>大きい＝人が付けた大切さの印</span><span><span aria-hidden="true">◆</span> 権利制限的対応</span><span>点線＝関係の候補（因果ではない）</span>
    </div>`;
  }
  function selbarHtml() {
    const s = sceneById[st.selected];
    if (!s) return `<span class="note">出来事を選ぶと、ここに選んだ内容が出ます（Tab で出来事に移り、Enter で選べます）。</span>`;
    return `<span class="selbar-label">選択中</span>
      <b>${s.id} ${fmtDate(s.date)}（${yearOf(s.date) - birthYear}歳ごろ）</b>
      <span class="selbar-text">${esc(clip(s.text, 46))}</span>
      <span style="flex:1"></span>
      <a class="btn small" href="#summary" id="toSummary">選んだ出来事の要約へ ↓</a>
      <a class="btn small primary" href="#/p/${PID}/v2?focus=${s.id}">詳細版（V2）で開く →</a>`;
  }
  function periodEntryHtml() {
    const firstIn = (start, end) => scenes.find((x) => x.date >= start && x.date < end);
    const placeBtns = S.places.map((p) => { const f = firstIn(p.start, p.end); return f ? `<a class="btn" href="#/p/${PID}/v2?unit=place&focus=${f.id}">${esc(p.name)} <span class="muted">${p.start.slice(0, 4)}–${p.end.slice(0, 4) === "2026" ? "現在" : p.end.slice(0, 4)}</span></a>` : ""; }).join("");
    const stageBtns = STAGES.map((g) => { const f = firstIn(`${birthYear + g.from}-01-01`, `${birthYear + g.to + 1}-01-01`); return f ? `<a class="btn" href="#/p/${PID}/v2?unit=stage&focus=${f.id}">${g.name} <span class="muted">${g.from}〜${g.to > 100 ? "" : g.to}歳</span></a>` : ""; }).join("");
    const years = [...new Set(scenes.map((x) => yearOf(x.date)))].sort((x, y) => x - y);
    const yearBtns = years.map((y) => { const f = scenes.find((x) => yearOf(x.date) === y); const n = scenes.filter((x) => yearOf(x.date) === y).length; return `<a class="chip" href="#/p/${PID}/v2?focus=${f.id}">${y}年 <span class="muted">${n}件</span></a>`; }).join("");
    return `<section class="card v1-periods" id="periods" aria-labelledby="perH">
      <h2 id="perH">年・時期から一覧で見る</h2>
      <p class="note">選んだ時期の最初の出来事から、詳細版（V2）の一覧が開きます。</p>
      <div class="per-row"><span class="per-label">住まい</span>${placeBtns}</div>
      <div class="per-row"><span class="per-label">ライフステージ</span>${stageBtns}</div>
      <details><summary>年から選ぶ（${years.length}年分）</summary><div class="per-years">${yearBtns}</div></details>
    </section>`;
  }
  function renderV1() {
    crumbs.innerHTML = `<a href="#/">ホーム</a> › <a href="#/p/${PID}">P001 ダッシュボード</a> › V1 全体概要版`;
    const themes = [...new Set(S.relations.filter((r) => r.type === "theme").map((r) => r.theme))];
    const allRel = Object.keys(REL).filter((k) => k !== "theme").every((k) => st.relTypes[k]);
    const basicRel = Object.keys(REL).filter((k) => k !== "theme").every((k) => st.relTypes[k] === BASIC_REL.includes(k));
    app.innerHTML = `
      <div class="v1-page">
        <div class="v1-head">
          <h1>P001 ライフストーリー 全体概要版</h1>
          <p class="v1-lead">横は年と年齢です。出来事を「病気・生活・社会制度」の3つの帯に置いています。出来事を選ぶと、図のすぐ下に内容が出ます。<a href="#periods" id="toPeriods">年・時期から一覧で見る ↓</a></p>
        </div>
        <section class="card v1-chart" aria-labelledby="chartH">
          <h2 id="chartH" class="sr-only">全体概要の図</h2>
          ${shortLegendHtml()}
          <div class="viz" id="v1"></div>
          <div class="v1-selbar" id="selbar" aria-live="polite">${selbarHtml()}</div>
          <div class="v1-controls">
            ${LAYERS.map((l) => `<label><input type="checkbox" data-layer="${l.id}" ${st.layers[l.id] ? "checked" : ""}><span class="layer-dot ld-${l.id}" aria-hidden="true"></span>${l.name}</label>`).join("")}
            <label>問いで強調 <select id="qSel"><option value="">なし</option>${M.questions.map((q) => `<option value="${q["問ID"]}" ${st.focusQ === +q["問ID"] ? "selected" : ""}>問い${["", "①", "②", "③"][+q["問ID"]]}（${q["参照場面ID"]}）</option>`).join("")}</select></label>
            <label>本人らしさ・テーマ <select id="themeSel"><option value="">なし</option>${themes.map((th) => `<option ${st.theme === th ? "selected" : ""}>${th}</option>`).join("")}</select></label>
            <label>大きさの見方 <select id="viewBy">${[["all", "全員の印"], ["本人", "本人の印だけ"], ["支援者", "支援者の印だけ"], ["家族", "家族の印だけ"], ["ピア", "ピアの印だけ"]].map(([v, n]) => `<option value="${v}" ${st.viewBy === v ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          </div>
          <div class="v1-controls">
            <span class="ctl-label">関係線</span>
            <button class="btn small" id="relBasic" aria-pressed="${basicRel}">基本だけ（移行・制度による対応）</button>
            <button class="btn small" id="relAll" aria-pressed="${allRel}">すべて表示</button>
            <details class="rel-more"><summary>関係線を選んで追加</summary>
              ${Object.entries(REL).filter(([k]) => !["theme", "participant"].includes(k)).map(([k, v]) => `<label><input type="checkbox" data-rel-type="${k}" ${st.relTypes[k] ? "checked" : ""}>${v.name}</label>`).join("")}
            </details>
          </div>
          <div class="v1-controls">
            <form id="periodForm" class="period-form" aria-label="表示する期間">
              <label>期間 <input type="number" name="from" min="1981" max="2026" value="${st.domain ? new Date(st.domain[0]).getFullYear() : 1981}" aria-label="開始年"></label>
              <span aria-hidden="true">〜</span>
              <label><span class="sr-only">終了年</span><input type="number" name="to" min="1981" max="2026" value="${st.domain ? new Date(st.domain[1]).getFullYear() : 2026}" aria-label="終了年"></label>
              <button class="btn small" type="submit">この期間を表示</button>
            </form>
            ${st.domain ? `<button class="btn small" id="resetZoom">全期間に戻す</button>` : `<span class="note">図の上をドラッグしても拡大できます</span>`}
          </div>
        </section>
        <section class="card summary" id="summary" tabindex="-1" aria-labelledby="sumH"></section>
        ${periodEntryHtml()}
        <details class="card v1-legend-more">
          <summary><b>詳しい読み方</b>（色・形・大きさ・印・関係線の意味）</summary>
          ${legendHtml().replace('<div class="legend card">', '<div class="legend">')}
        </details>
      </div>`;
    const draw = () => renderTimeline($("#v1"), {
      onSelect: (id) => { draw(); renderSummary(id); $("#selbar").innerHTML = selbarHtml(); bindSelbar(); $(`#v1 [data-node="${id}"]`)?.focus(); announce(`${id} を選びました。図のすぐ下に内容があります`); },
      onZoom: () => renderV1(),
    });
    const bindSelbar = () => { const a = $("#toSummary"); if (a) a.onclick = (e) => { e.preventDefault(); const box = $("#summary"); box.scrollIntoView({ block: "start", behavior: scrollBehavior() }); box.focus({ preventScroll: true }); }; };
    draw();
    renderSummary(st.selected);
    bindSelbar();
    $("#toPeriods").onclick = (e) => { e.preventDefault(); const p = $("#periods"); p.scrollIntoView({ block: "start", behavior: scrollBehavior() }); p.querySelector("a")?.focus({ preventScroll: true }); };
    app.querySelectorAll("[data-layer]").forEach((c) => (c.onchange = () => { st.layers[c.dataset.layer] = c.checked; draw(); }));
    app.querySelectorAll("[data-rel-type]").forEach((c) => (c.onchange = () => { st.relTypes[c.dataset.relType] = c.checked; draw(); }));
    const setRel = (all) => { for (const k of Object.keys(REL)) if (k !== "theme") st.relTypes[k] = all || BASIC_REL.includes(k); renderV1(); $(all ? "#relAll" : "#relBasic")?.focus(); announce(all ? "関係線をすべて表示しています" : "基本の関係線だけを表示しています"); };
    $("#relBasic").onclick = () => setRel(false);
    $("#relAll").onclick = () => setRel(true);
    $("#qSel").onchange = (e) => { st.focusQ = e.target.value ? +e.target.value : null; draw(); };
    $("#themeSel").onchange = (e) => { st.theme = e.target.value; draw(); };
    $("#viewBy").onchange = (e) => { st.viewBy = e.target.value; draw(); };
    if ($("#resetZoom")) $("#resetZoom").onclick = () => { st.domain = null; renderV1(); $("#periodForm input")?.focus(); announce("全期間を表示しています"); };
    $("#periodForm").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      let a = +f.get("from"), b = +f.get("to");
      if (!(a >= 1981 && b <= 2026 && a <= b)) { announce("期間は 1981〜2026 年の範囲で、開始年を終了年以下にしてください"); return; }
      st.domain = [t(`${a}-01-01`), t(`${b}-12-31`)];
      renderV1(); $("#periodForm button")?.focus(); announce(`${a}年〜${b}年を表示しています`);
    };
    if (st.selected) $(`#v1`).querySelector(".sel-ring")?.closest("g")?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }

  function renderSummary(id) {
    const box = $("#summary");
    if (!box) return;
    const s = sceneById[id];
    if (!s) { box.innerHTML = `<h2 id="sumH" class="sum-h">選んだ出来事の要約</h2><div class="empty">図の出来事を選ぶと、ここに要約が出ます。詳細から記述・原記録までたどれます。</div>`; return; }
    const ms = marksFor(id);
    const rels = S.relations.filter((r) => (r.from === id || r.to === id) && relStatus(r) !== "棄却");
    const qs = quotesOf(s);
    box.innerHTML = `
      <h2 id="sumH" class="sum-h">選んだ出来事の要約：${s.id} ${fmtDate(s.date)}（${yearOf(s.date) - birthYear}歳ごろ）</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${s.layers.map((l) => `<span class="chip static"><span class="layer-dot ld-${l}" aria-hidden="true"></span>${layerName[l]}${l === s.primary ? "（主）" : ""}</span>`).join("")}
        <span class="badge cand">${esc(s.status)}</span>
        ${s.restraint ? '<span class="badge stop">◆ 権利制限的対応</span>' : ""}
      </div>
      <div class="note">${esc(s.heading)} ／ ${esc(s.recorder)}</div>
      <p class="sum-text">${esc(s.text)}</p>
      ${qs.length ? `<ul class="quote-list">${qs.map((q) => quoteLine(q, false)).join("")}</ul>` : ""}
      <div class="note">大切さの印: ${ms.length ? ms.map((m) => esc(m.role)).join("・") : "未評価"} ／ 関係 ${rels.length}件</div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn primary" id="openV2">詳細版（V2）で開く →</button>
        <button class="btn" id="openDetail">パネルで記述・原記録を見る</button>
        <button class="btn" id="markHere">${ms.some((m) => m.role === role()) ? "印を取り消す" : `大切だと思う（${esc(role())}）`}</button>
      </div>`;
    $("#openV2").onclick = () => (location.hash = `#/p/${PID}/v2?focus=${id}`);
    $("#openDetail").onclick = () => { drawerStack = []; openScene(id); };
    $("#markHere").onclick = () => { toggleMark(id); renderV1(); };
  }

  // ---------- V2 詳細版 (F-3.2) & V1 <-> V2 navigation (F-3.3) ----------
  const STAGES = [
    { name: "乳幼児期", from: 0, to: 5 }, { name: "学童期", from: 6, to: 11 }, { name: "中学・高等部", from: 12, to: 18 },
    { name: "青年期", from: 19, to: 29 }, { name: "壮年期", from: 30, to: 120 },
  ];
  st.v2Unit = "place";        // "place" | "stage"
  st.v2Open = new Set();      // expanded cards
  st.v2OpenBlocks = new Set();// blocks opened despite being outside the V1 period
  let v2Jumps = 0;            // in-V2 jumps that browser "back" can undo

  function v2Blocks() {
    if (st.v2Unit === "stage") {
      return STAGES.map((g) => ({ name: g.name, start: `${birthYear + g.from}-01-01`, end: `${birthYear + g.to}-12-31`, sub: `${g.from}〜${g.to > 100 ? "" : g.to}歳` }));
    }
    return S.places.map((p) => ({ name: p.name, start: p.start, end: p.end, sub: "住まい（候補）" }));
  }
  const inBlock = (b, date) => date >= b.start && date < b.end;
  const sceneVisible = (s) => s.layers.some((l) => st.layers[l]);
  function highlightSet() {
    if (st.focusQ) return questionScenes(st.focusQ);
    if (st.theme) return new Set(scenes.filter((s) => s.themes.includes(st.theme)).map((s) => s.id));
    return null;
  }
  const quotesOf = (s) => (unitsByScene[s.id] || []).slice().sort((a, b) => a.order - b.order).flatMap((u) => (u.quotes || []).map((q) => ({ ...q, unit: u.id })));

  function v2CardHtml(s, side, hl) {
    const open = st.v2Open.has(s.id);
    const ms = marksFor(s.id);
    const quotes = quotesOf(s);
    const selfQ = quotes.filter((q) => q.speaker === "本人"), otherQ = quotes.filter((q) => q.speaker !== "本人");
    const rels = S.relations.filter((r) => (r.from === s.id || r.to === s.id) && relStatus(r) !== "棄却");
    const qs = [1, 2, 3].filter((n) => questionScenes(n).has(s.id));
    const cls = ["v2-card", side, hl && !hl.has(s.id) ? "dim" : "", hl && hl.has(s.id) ? "hl" : "", st.selected === s.id ? "sel" : ""].join(" ");
    let body = "";
    if (open) {
      const units = (unitsByScene[s.id] || []).sort((a, b) => a.order - b.order);
      const relOther = (r) => (r.from === s.id ? r.to : r.from);
      const byType = {};
      for (const r of rels) (byType[r.type] ||= []).push(r);
      body = `
        <div class="v2-body">
          <h5>場面の原文</h5><div class="rawtext">${esc(s.text)}</div>
          <h5>記述ユニットと自動抽出候補（${units.length}）</h5>
          ${units.map((u) => `<div class="unit"><span class="note">${u.id}</span> ${esc(u.text)}
            ${(u.quotes || []).length ? `<ul class="quote-list">${u.quotes.map((q) => quoteLine({ ...q, unit: u.id }, true)).join("")}</ul>` : ""}
            ${(candsByUnit[u.id] || []).map((c) => `<div class="cand-line">▸ ${CAND_LABEL[c.type]}（${esc(c.kind)}）<span class="badge cand">${esc(c.status || "要確認")}</span></div>`).join("")}</div>`).join("")}
          <h5>レイヤ（自動候補・要人手確定）</h5>
          ${s.layers.map((l) => `<div class="note"><span class="layer-dot ld-${l}"></span> <b>${layerName[l]}</b>${l === s.primary ? "（主）" : ""}：${esc(s.layerReasons[l].join("、"))}</div>`).join("")}
          <h5>関係（${rels.length}）<span class="muted">— 因果ではありません</span></h5>
          ${rels.length ? Object.entries(byType).map(([type, rs]) => `<div class="note" style="margin-top:4px"><b>${REL[type].name}</b></div>` + rs.map((r) => {
            const o = relOther(r);
            return `<div class="rel-item">
              <button class="btn small" data-jump="${o}">${r.from === s.id ? "→" : "←"} ${o} ${fmtDate(sceneById[o].date)} へ移動</button>
              ${r.direction ? `<span class="badge">${r.direction === "constrain" ? "制約した" : "可能にした"}：${esc(r.system)}</span>` : ""}
              <span class="badge ${relStatus(r) === "採用" ? "ok" : "cand"}">${esc(relStatus(r))}</span>
              <div class="note">${esc(r.desc)} ／ 見方: ${esc(r.by)} ／ ${esc(r.confirm)}</div>
              <div><button class="btn small" data-rel="${r.id}" data-set="採用">採用</button> <button class="btn small" data-rel="${r.id}" data-set="棄却">棄却</button></div></div>`;
          }).join("")).join("") : '<div class="empty">関係はまだありません。</div>'}
          ${qs.length ? `<h5>関連する問い</h5>${qs.map((n) => `<button class="btn small" data-focusq="${n}">問い${["", "①", "②", "③"][n]}で強調</button>`).join(" ")}` : ""}
          <h5>原典</h5>
          <button class="btn small" data-raw="${s.rawId}">原記録 ${s.rawId} の全文を${st.v2Raw === s.id ? "閉じる" : "表示"}</button>
          ${st.v2Raw === s.id ? `<div class="rawtext" style="margin-top:6px">${esc(rawById[s.rawId]?.text)}</div><p class="note">閲覧範囲（全文／抜粋／記録IDのみ）は未決事項 U-3。</p>` : ""}
        </div>`;
    }
    return `<article class="${cls}" id="card-${s.id}" data-id="${s.id}" data-date="${s.date}">
      <span class="v2-dot ld-${s.primary}"></span>
      <div class="v2-meta">
        <b>${fmtDate(s.date)}</b> <span class="muted">${yearOf(s.date) - birthYear}歳ごろ・${s.id}</span>
        ${/暫定/.test(s.certainty) ? '<span class="badge">時期は暫定</span>' : s.dateRange ? `<span class="badge">${esc(s.certainty)}</span>` : ""}
        ${s.restraint ? '<span class="badge stop">◆ 権利制限的対応</span>' : ""}
      </div>
      <div class="v2-place">${esc(s.recorder)}</div>
      <div class="v2-chips">${s.layers.map((l) => `<span class="chip"><span class="layer-dot ld-${l}"></span>${layerName[l]}${l === s.primary ? "（主）" : ""}</span>`).join("")}
        ${s.themes.map((th) => `<span class="badge">${esc(th)}</span>`).join("")}</div>
      ${open ? "" : `<p class="v2-sum">${esc(clip(s.text, 84))}</p>`}
      ${selfQ.length ? `<blockquote class="v2-voice"><span class="spk spk-self">本人の表現（候補・要確認）</span> ${selfQ.slice(0, 3).map((q) => `「${esc(q.text)}」`).join(" ")}</blockquote>` : ""}
      ${!open && otherQ.length ? `<ul class="quote-list compact">${otherQ.slice(0, 2).map((q) => quoteLine(q, false)).join("")}${otherQ.length > 2 ? `<li class="note">ほかに引用 ${otherQ.length - 2}件（「詳しく」で表示）</li>` : ""}</ul>` : ""}
      <div class="v2-foot">
        <span class="badge cand">原記録由来・${esc(s.status)}</span>
        <span class="badge ${ms.some((m) => m.role === "本人") ? "ok" : ""}">大切さの印: ${ms.length ? ms.map((m) => esc(m.role)).join("・") : "未評価"}</span>
        ${store.d.personReactions?.[s.id] ? `<span class="badge ok">本人の反応: ${esc(store.d.personReactions[s.id].value)}</span>` : ""}
        <span style="flex:1"></span>
        <button class="btn small" data-mark="${s.id}">${ms.some((m) => m.role === role()) ? "印を取り消す" : "大切だと思う"}</button>
        <button class="btn small" data-v1="${s.id}" title="V1 全体概要版でこの出来事の位置を見る">V1で位置 ↑</button>
        <button class="btn small ${open ? "" : "primary"}" data-toggle="${s.id}" aria-expanded="${open}" aria-controls="card-${s.id}">${open ? "たたむ" : "詳しく"}<span class="sr-only">（${s.id}）</span></button>
      </div>
      ${body}
    </article>`;
  }

  function v2EventHtml(e, side) {
    return `<article class="v2-card ${side} new" id="card-${e.id}" data-date="${e.date}">
      <span class="v2-dot star">★</span>
      <div class="v2-meta"><b>${fmtDate(e.date)}</b> <span class="muted">${esc(e.id)}・試行計画 ${esc(e.plan || "P1")}</span>
        <span class="badge ok">新しく加わったこと（循環1）</span> ${e.stopped ? '<span class="badge stop">中止</span>' : '<span class="badge">実施</span>'}</div>
      <div class="v2-place">1.5回目の実践の出来事（このブラウザで記録した試作データ）</div>
      <p class="v2-sum">変更: ${esc(e.change)}</p>
      <blockquote class="v2-voice">${esc(e.expression)}<span class="note">本人が表したこと（記録者による原文記述）</span></blockquote>
      ${e.afterPerson ? `<div class="note">余韻（本人のその後）: ${esc(e.afterPerson)}</div>` : ""}
      ${e.afterSupporter ? `<div class="note">余韻（支援者自身）: ${esc(e.afterSupporter)}</div>` : ""}
    </article>`;
  }

  function renderV2(params) {
    crumbs.innerHTML = `<a href="#/">ホーム</a> › <a href="#/p/${PID}">P001 ダッシュボード</a> › <a href="#/p/${PID}/v1">V1 全体概要版</a> › V2 詳細版`;
    const themes = [...new Set(scenes.flatMap((s) => s.themes))];
    const hl = highlightSet();
    if (params.unit === "place" || params.unit === "stage") st.v2Unit = params.unit;
    const map = (store.d.v2map ||= { collapsed: false, small: false });
    const blocks = v2Blocks();
    const dom = st.domain;
    let n = 0;
    const blocksHtml = blocks.map((b, bi) => {
      const items = scenes.filter((s) => inBlock(b, s.date) && sceneVisible(s)).map((s) => ({ date: s.date, s }))
        .concat(st.layers.life ? events().filter((e) => inBlock(b, e.date)).map((e) => ({ date: e.date, e })) : [])
        .sort((a, c) => (a.date < c.date ? -1 : 1));
      const outside = dom && (t(b.end) < dom[0] || t(b.start) > dom[1]);
      const collapsed = outside && !st.v2OpenBlocks.has(bi);
      const themesHere = Object.entries(items.filter((i) => i.s).flatMap((i) => i.s.themes).reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {}))
        .sort((a, c) => c[1] - a[1]).slice(0, 3).map(([k]) => k);
      const side = bi % 2 ? "right" : "left";
      return `<section class="v2-block ${collapsed ? "collapsed" : ""}" id="blk-${bi}" data-start="${b.start}" data-end="${b.end}">
        <div class="v2-ribbon ${side}">
          <span class="v2-years">${b.start.slice(0, 4)}–${b.end.slice(0, 4) === "2026" ? "現在" : b.end.slice(0, 4)}</span>
          <span><b>${esc(b.name)}</b> <span class="muted">${esc(b.sub)}・${items.length}件</span></span>
          ${themesHere.length ? `<span class="v2-themes">よく出てくる：${themesHere.map(esc).join("・")}</span>` : ""}
        </div>
        <div class="v2-photo ${side}" title="代表の写真・作品（本人の掲載意思が確認できたもののみ表示）" aria-hidden="true">
          <span>写真・作品<br>（未登録）</span>
        </div>
        ${collapsed ? `<div class="v2-collapsed note">V1 で選んだ期間の外です。<button class="btn small" data-openblock="${bi}">この時期を開く</button></div>` :
          `<div class="v2-items">${items.map((i) => (n++, i.s ? v2CardHtml(i.s, n % 2 ? "L" : "R", hl) : v2EventHtml(i.e, n % 2 ? "L" : "R"))).join("") || '<div class="empty" style="text-align:center">表示できる出来事がありません</div>'}</div>`}
      </section>`;
    }).join("");

    app.innerHTML = `
      <div class="v2-wrap">
        <div class="v2-main">
          <div class="card v2-head">
            <div class="v1-controls">
              <h1 class="inline-h1">P001 ライフストーリー 詳細版</h1>
              <label>時期の区切り <select id="v2Unit"><option value="place" ${st.v2Unit === "place" ? "selected" : ""}>住まい</option><option value="stage" ${st.v2Unit === "stage" ? "selected" : ""}>ライフステージ</option></select></label>
              ${LAYERS.map((l) => `<label><input type="checkbox" data-layer="${l.id}" ${st.layers[l.id] ? "checked" : ""}><span class="layer-dot ld-${l.id}"></span>${l.name}</label>`).join("")}
              <label>問いで強調 <select id="qSel"><option value="">なし</option>${M.questions.map((q) => `<option value="${q["問ID"]}" ${st.focusQ === +q["問ID"] ? "selected" : ""}>問い${["", "①", "②", "③"][+q["問ID"]]}</option>`).join("")}</select></label>
              <label>テーマ <select id="themeSel"><option value="">なし</option>${themes.map((th) => `<option ${st.theme === th ? "selected" : ""}>${th}</option>`).join("")}</select></label>
            </div>
            ${dom ? `<div class="note">V1 で選んだ期間（${new Date(dom[0]).getFullYear()}〜${new Date(dom[1]).getFullYear()}年）から表示しています。期間外の時期はたたんでいます。 <button class="btn small" id="clearDom">全期間を表示</button></div>` : ""}
            <div class="note">表示・強調・期間の状態は V1 と共有しています。</div>
          </div>
          <div class="v2-timeline">${blocksHtml}</div>
        </div>
        <aside class="v2-side ${map.small ? "small" : ""}" aria-label="現在地と読み方">
          <section class="card map-card" aria-labelledby="mapH">
            <div class="map-head">
              <h2 id="mapH">全体の中の現在地</h2>
              <button class="btn small" id="mapSize" aria-pressed="${!!map.small}">小さくする</button>
              <button class="btn small" id="mapToggle" aria-expanded="${!map.collapsed}" aria-controls="mapBody">${map.collapsed ? "ひらく" : "たたむ"}</button>
            </div>
            <div id="mapBody" ${map.collapsed ? "hidden" : ""}>
              <div class="viz" id="v2mini" title="クリック・ドラッグでその時期へ移動"></div>
              <div class="note" id="v2where" aria-live="off">—</div>
            </div>
            <div class="map-actions">
              <button class="btn small primary" id="backV1">↑ 概要へ戻る</button>
              <button class="btn small" id="v2back" ${v2Jumps ? "" : "hidden"}>← 直前の場所へ戻る</button>
            </div>
          </section>
          <details class="card legend" style="margin-top:10px">
            <summary><b>読み方</b></summary>
            <div class="li"><span class="layer-dot ld-illness"></span>病気</div>
            <div class="li"><span class="layer-dot ld-life"></span>生活</div>
            <div class="li"><span class="layer-dot ld-institution"></span>社会制度</div>
            <div class="li">★ 実践で新しく加わったこと</div>
            <p class="note">引用文には発言者を付けています（本人／母／父／支援者／その他の家族）。手がかりがないものは「引用文：発言者未確認」です。発言者は自動判定の候補で、人手確認が必要です。関係は因果を意味しません。</p>
          </details>
        </aside>
      </div>`;

    // mini overview with viewport frame (FR-3.3.3)
    const mini = renderTimeline($("#v2mini"), { compact: true, minW: 240 });
    const geo = mini.__geo;
    const frame = svg("rect", { y: 2, height: geo.H - 16, fill: "var(--accent)", opacity: 0.16, stroke: "var(--accent)", "stroke-width": 1.5, rx: 3 }, mini);
    const scrollToDate = (ms) => {
      const cards = [...app.querySelectorAll(".v2-card")];
      if (!cards.length) return;
      let best = cards[0], bd = Infinity;
      for (const c of cards) { const d = Math.abs(t(c.dataset.date) - ms); if (d < bd) { bd = d; best = c; } }
      best.scrollIntoView({ block: "center", behavior: scrollBehavior() });
    };
    let dragging = false;
    const pick = (e) => { const r = mini.getBoundingClientRect(); scrollToDate(geo.inv((e.clientX - r.left) * (geo.W / r.width))); };
    mini.addEventListener("mousedown", (e) => { dragging = true; pick(e); });
    mini.addEventListener("mousemove", (e) => { if (dragging) pick(e); });
    window.addEventListener("mouseup", () => (dragging = false), { once: true });

    const updateWhere = () => {
      const vis = [...app.querySelectorAll(".v2-card")].filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > 80 && r.top < innerHeight; });
      if (!vis.length) return;
      const d0 = vis[0].dataset.date, d1 = vis[vis.length - 1].dataset.date;
      const x0 = geo.x(t(d0)), x1 = geo.x(t(d1));
      frame.setAttribute("x", Math.min(x0, x1) - 4);
      frame.setAttribute("width", Math.max(8, Math.abs(x1 - x0) + 8));
      const blk = vis[0].closest(".v2-block");
      const name = blk?.querySelector(".v2-ribbon b")?.textContent || "";
      st.v2Current = vis[0].dataset.id || st.v2Current;
      $("#v2where").textContent = `いま見ている時期：${name}（${d0.slice(0, 4)}〜${d1.slice(0, 4)}年・${vis.length}件）`;
    };
    let raf = 0;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if ($("#v2mini") && !$("#mapBody")?.hidden) updateWhere(); }); };
    window.removeEventListener("scroll", window.__v2scroll || (() => {}));
    window.__v2scroll = onScroll;
    window.addEventListener("scroll", onScroll, { passive: true });

    // controls (shared state with V1)
    $("#v2Unit").onchange = (e) => { st.v2Unit = e.target.value; st.v2OpenBlocks.clear(); renderV2({}); };
    app.querySelectorAll("[data-layer]").forEach((c) => (c.onchange = () => { st.layers[c.dataset.layer] = c.checked; renderV2({}); }));
    $("#qSel").onchange = (e) => { st.focusQ = e.target.value ? +e.target.value : null; renderV2({}); };
    $("#themeSel").onchange = (e) => { st.theme = e.target.value; renderV2({}); };
    if ($("#clearDom")) $("#clearDom").onclick = () => { st.domain = null; renderV2({}); };
    $("#backV1").onclick = () => {
      const id = st.selected && sceneById[st.selected] ? st.selected : st.v2Current;
      location.hash = `#/p/${PID}/v1${id && sceneById[id] ? `?sel=${id}` : ""}`;
    };
    $("#v2back").onclick = () => history.back();
    $("#mapToggle").onclick = () => {
      map.collapsed = !map.collapsed; store.save();
      $("#mapBody").hidden = map.collapsed;
      $("#mapToggle").setAttribute("aria-expanded", String(!map.collapsed));
      $("#mapToggle").textContent = map.collapsed ? "ひらく" : "たたむ";
      if (!map.collapsed) updateWhere();
      announce(map.collapsed ? "現在地図をたたみました" : "現在地図をひらきました");
    };
    $("#mapSize").onclick = () => {
      map.small = !map.small; store.save();
      app.querySelector(".v2-side").classList.toggle("small", map.small);
      $("#mapSize").setAttribute("aria-pressed", String(map.small));
      announce(map.small ? "現在地図を小さくしました" : "現在地図を元の大きさにしました");
    };

    // card actions (delegated)
    app.querySelector(".v2-timeline").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const d = b.dataset;
      const keep = (id) => {
        const y = document.getElementById("card-" + id)?.getBoundingClientRect().top;
        const key = Object.entries(b.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}="${v}"]`).join("");
        renderV2({});
        const c = document.getElementById("card-" + id);
        if (c && y !== undefined) window.scrollBy(0, c.getBoundingClientRect().top - y);
        (c?.querySelector(`button${key}`) || c?.querySelector("[data-toggle]"))?.focus({ preventScroll: true });
      };
      if (d.toggle) { st.v2Open.has(d.toggle) ? st.v2Open.delete(d.toggle) : st.v2Open.add(d.toggle); st.selected = d.toggle; keep(d.toggle); }
      else if (d.mark) { toggleMark(d.mark); keep(d.mark); announce(`${d.mark} の大切さの印を更新しました`); }
      else if (d.raw) { const id = b.closest(".v2-card").dataset.id; st.v2Raw = st.v2Raw === id ? null : id; keep(id); }
      else if (d.rel) { store.d.relStatus[d.rel] = d.set; store.save(); keep(b.closest(".v2-card").dataset.id); announce(`関係を「${d.set}」にしました`); }
      else if (d.focusq) { st.focusQ = +d.focusq; keep(b.closest(".v2-card").dataset.id); }
      else if (d.v1) location.hash = `#/p/${PID}/v1?sel=${d.v1}`;
      else if (d.jump) { v2Jumps++; location.hash = `#/p/${PID}/v2?focus=${d.jump}`; }
      else if (d.openblock) { st.v2OpenBlocks.add(+d.openblock); renderV2({}); document.getElementById("blk-" + d.openblock)?.scrollIntoView({ block: "start" }); }
    };

    if (params.focus) focusCard(params.focus, !params.instant);
    else if (dom) {
      const first = [...app.querySelectorAll(".v2-card")].find((c) => t(c.dataset.date) >= dom[0]);
      first?.scrollIntoView({ block: "start" });
    }
    updateWhere();
  }

  function focusCard(id, smooth = true) {
    const s = sceneById[id];
    if (s) {
      st.selected = id;
      st.v2Open.add(id);
      const bi = v2Blocks().findIndex((b) => inBlock(b, s.date));
      if (bi >= 0) st.v2OpenBlocks.add(bi);
      if (!sceneVisible(s)) st.layers[s.primary] = true;
      renderV2({});
    }
    const c = document.getElementById("card-" + id);
    if (!c) return;
    c.scrollIntoView({ block: "start", behavior: scrollBehavior(smooth) });
    c.querySelector("[data-toggle]")?.focus({ preventScroll: true });
    c.classList.add("flash");
    setTimeout(() => c.classList.remove("flash"), 1600);
  }

  // ---------- router ----------
  let currentView = null;
  function route() {
    const h = location.hash || "#/";
    const [path, q] = h.split("?");
    return { path, params: Object.fromEntries(new URLSearchParams(q || "")) };
  }
  const TITLES = { home: "ホーム", dash: "P001 ケース会議ダッシュボード", v1: "P001 全体概要版（V1）", v2: "P001 詳細版（V2）" };
  const extraRoutes = {};
  function render(keepDrawer) {
    const { path, params } = route();
    if (!keepDrawer) hideTipNow();
    document.body.dataset.view = "";
    const extra = Object.keys(extraRoutes).find((k) => path === k);
    if (extra) {
      window.removeEventListener("scroll", window.__v2scroll || (() => {}));
      const r = extraRoutes[extra];
      document.body.dataset.view = r.view;
      r.render(params, keepDrawer);
      currentView = r.view;
      document.title = `${r.title} — TOMONI（試作）`;
      return;
    }
    if (path !== `#/p/${PID}/v2`) { window.removeEventListener("scroll", window.__v2scroll || (() => {})); v2Jumps = 0; }
    if (path === `#/p/${PID}/v2`) {
      if (currentView === "v2" && params.focus && !keepDrawer && (!params.unit || params.unit === st.v2Unit)) focusCard(params.focus);
      else renderV2({ ...params, instant: true });
      currentView = "v2";
    } else if (path === `#/p/${PID}/v1`) {
      if (params.sel && sceneById[params.sel]) st.selected = params.sel;
      renderV1(); currentView = "v1";
    } else if (path.startsWith(`#/p/${PID}/d/`)) { renderDetail(path.split("/").pop(), params); currentView = "detail"; return; }
    else if (path === `#/p/${PID}`) { renderDashboard(); currentView = "dash"; }
    else { renderHome(); currentView = "home"; }
    document.title = `${TITLES[currentView]} — TOMONI（試作）`;
  }
  window.addEventListener("hashchange", () => {
    closeDrawer();
    const { path } = route();
    const sameV2 = currentView === "v2" && path === `#/p/${PID}/v2`;
    if (!sameV2) window.scrollTo(0, 0);
    render();
    if (!sameV2 && !route().params.focus && !app.contains(document.activeElement)) $("#app").focus({ preventScroll: true });
  });
  $("#skipLink")?.addEventListener("click", (e) => { e.preventDefault(); $("#app").focus(); });
  let rt, lastW = innerWidth;
  window.addEventListener("resize", () => { if (innerWidth === lastW) return; lastW = innerWidth; clearTimeout(rt); rt = setTimeout(() => render(true), 150); });
  document.getElementById("roleSelect").onchange = () => {
    store.d.role = role(); store.save();
    if (role() === "本人") { location.hash = `#/p/${PID}/v3`; return; }
    render(true); announce(`操作者の立場を「${role()}」にしました`);
  };

  // API for views.js (V3 本人向け絵巻物, 会議画面)
  window.TOMONI = {
    S, M, PID, st, store, birthYear, LAYERS, layerName, PART_COLORS, CAND_LABEL,
    scenes, sceneById, unitsByScene, unitById, rawById,
    $, esc, t, fmtDate, yearOf, clip, svg, role, announce, scrollBehavior,
    marksFor, toggleMark, questionRefs, questionScenes, parseRefs, refChip,
    renderTimeline, openScene, closeDrawer, stepperHtml, setRole,
    crumbs: () => crumbs, app: () => app,
    route: (path, view, title, fn) => { extraRoutes[path] = { view, title, render: fn }; },
    rerender: (keep) => render(keep),
  };
  document.addEventListener("DOMContentLoaded", () => render());
})();
