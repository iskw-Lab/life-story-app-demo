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
  const refLabel = (r) => refText(r);
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

  // ---------- plain-language state of the cycle ----------
  const PHASE_PLAIN = { "0回目": "生育史を振り返る段階", "1回目": "会議で一緒に味わう段階", "1.5回目": "日常で試す段階", "2回目": "振り返って支援を見直す段階", "まとめ": "まとめる段階", "追跡": "その後を確かめる段階" };
  function cycleState() {
    // seed: 0回目・1回目（模擬会議 M-C1008-01）は済み。今は日常で試す段階
    return { done: ["0回目", "1回目"], now: "1.5回目" };
  }
  function stepperHtml() {
    const c = cycleState();
    return `<div class="stepper" aria-label="循環の進み具合">${PHASES.map((p) => `<span class="step ${c.done.includes(p) ? "done" : p === c.now ? "now" : ""}"${p === c.now ? ' aria-current="step"' : ""}><i aria-hidden="true"></i>${p}</span>`).join("")}</div>`;
  }
  const pendingCands = () => S.candidates.filter((c) => /要確認|未検証/.test(c.status || "要確認")).length;
  const pendingAfterglow = () => events().filter((e) => !e.afterPerson && !e.afterSupporter).length;

  // ---------- 身体と医療の経過 (F-15, P-11) ----------
  // Interpretation may wait; body signs and pain go to a follow-up check now.
  const RECENT_YEAR = 2019;
  const bodyByScene = group(S.candidates.filter((c) => c.type === "body"), "sceneId");
  const HEALTH_STATUS = ["未確認", "確認中", "対応済み", "経過観察"];
  const healthOf = (id) => (store.d.health || {})[id] || null;
  const healthPending = () => Object.keys(bodyByScene)
    .filter((id) => yearOf(sceneById[id].date) >= RECENT_YEAR && !["対応済み", "経過観察"].includes(healthOf(id)?.status))
    .sort((a, b) => sceneById[b].date.localeCompare(sceneById[a].date));

  // ---------- 管理語・関わりの記述 (FR-5.6, FR-5.7) ----------
  // A prompt to re-read from the person's side; never a ban or a forced rewrite.
  const MGMT_RE = /不穏|粗暴|拒否|落ち着|おとなしく|興奮|パニック|問題行動|他害|暴れ|大声|奇声|多動/;
  const MGMT_SHOW = { "落ち着": "落ち着いた", "おとなしく": "おとなしくなった" };
  const MGMT_QS = ["このとき本人は何を伝えたかったか", "何に困っていたか", "どんな声かけや条件のもとでだったか"];
  const mgmtUnits = () => S.units.filter((u) => MGMT_RE.test(u.text));
  const BEHAV_RE = /叩|蹴|噛ん|噛み|噛も|大声|拒否|投げ|壊|座り込|飛び出|払っ|叫/;
  const ENGAGE_RE = /声をかけ|声かけ|伝え|示し|一緒に|誘|用意|選べ|選ん|待っ|聞い|尋ね|相談|見せ|渡し|説明|予告|置い|変え|移し/;
  const noEngageScenes = () => scenes.filter((x) => { const us = unitsByScene[x.id] || []; return us.some((u) => BEHAV_RE.test(u.text)) && !us.some((u) => ENGAGE_RE.test(u.text)); });
  // FR-8.3: words that describe the supporter's impression or only that behaviour stopped
  function expressionWarning(text) {
    if (/落ち着|おとなしく/.test(text)) return "「落ち着いた」は、行動が収まったことを示す言葉です。安心したとは限りません。表情・身体の緊張・示した言葉や動きをそのまま書き、支援者の印象は余韻の欄に書いてください。";
    if (MGMT_RE.test(text)) return `「${text.match(MGMT_RE)[0]}」は、本人の様子を支援する側から一語で言い表す言葉です。本人が示した言葉や動きをそのまま書いてください。`;
    if (/楽しそう|嬉しそう|うれしそう|満足|安心して|穏やか|機嫌/.test(text)) return "「楽しそう」などは支援者の印象です。印象は余韻の欄に書き、ここには示した言葉や動きをそのまま書いてください。";
    return "";
  }

  // ---------- 次にすること: one set per task (すること／担当／確認日／状態) ----------
  const TASK_STATUS = ["未着手", "進行中", "済"];
  function tasks() {
    const sum = by(M.summary, "項目ID");
    const items = (sum["F-nextAction"]["内容"].match(/[①②③④⑤]([^①②③④⑤]+?)(?=\s*[①②③④⑤]|。|$)/g) || []).map((x) => x.replace(/^[①②③④⑤]/, "").trim());
    const mockOwner = ["片岡・西田", "片岡・西田", "片岡・西田（由紀・新井が意見）", "高橋"];
    const list = items.map((text, i) => ({ id: `na${i + 1}`, text, owner: mockOwner[i] || "", ownerNote: "模擬会議の割当から", href: "" }));
    const hp = healthPending().length;
    if (hp) list.unshift({ id: "health", text: `身体サインの受診・対応を確かめる（${hp}件）`, owner: "", href: detailHref("health") });
    list.push({ id: "next-meeting", text: "次の会議（振り返って支援を見直す回）の日を決める", owner: "", href: "" });
    for (const e of events().filter((x) => !x.afterPerson && !x.afterSupporter)) list.push({ id: `after-${e.id}`, text: `${fmtDate(e.date)} の実践（${e.id}）に、その後の様子と余韻を書き足す`, owner: "", href: detailHref("practice") });
    for (const pl of store.d.plans || []) list.push({ id: `plan-${pl.id}`, text: `試行計画 ${pl.id} を試す：${pl.change}`, owner: pl.owner || "", date: pl.afterglowDate || "", href: detailHref("practice") });
    const ov = store.d.tasks || {};
    return list.map((t) => ({ status: "未着手", date: "", ...t, ...(ov[t.id] || {}) }));
  }
  const taskSetup = (t) => `<a class="setlink" href="${detailHref("next", "task-" + t.id)}">設定する<span class="sr-only">（${esc(t.text)}）</span></a>`;
  function taskRowHtml(t, editable) {
    const unset = (v) => (v ? esc(v) : `<span class="unset">未設定</span>${editable ? "" : ` ${taskSetup(t)}`}`);
    return `<div class="task ${t.status === "済" ? "done" : ""}" id="task-${t.id}">
      <dl class="task-kv">
        <div><dt>すること</dt><dd>${t.href ? `<a href="${t.href}">${esc(t.text)}</a>` : esc(t.text)}</dd></div>
        <div><dt>担当</dt><dd>${unset(t.owner)}${t.owner && t.ownerNote ? ` <span class="note">（${esc(t.ownerNote)}）</span>` : ""}</dd></div>
        <div><dt>確認日</dt><dd>${t.date ? fmtDate(t.date) : unset("")}</dd></div>
        <div><dt>状態</dt><dd><span class="badge ${t.status === "済" ? "ok" : ""}">${esc(t.status)}</span></dd></div>
      </dl>
      ${editable ? `<details class="task-edit"${st.taskEdit === t.id ? " open" : ""}><summary>担当・確認日・状態を${t.owner && t.date ? "変える" : "設定する"}<span class="sr-only">（${esc(t.text)}）</span></summary>
        <form class="evt task-form" data-task="${t.id}">
          <label>担当<input name="owner" value="${esc(t.owner)}" placeholder="例: 片岡"></label>
          <label>確認日<input type="date" name="date" value="${esc(t.date)}"></label>
          <label>状態<select name="status">${TASK_STATUS.map((x) => `<option ${x === t.status ? "selected" : ""}>${x}</option>`).join("")}</select></label>
          <button class="btn primary" type="submit">保存する</button>
        </form></details>` : ""}
    </div>`;
  }

  // content-first labels for record links (e.g. 「午前と夕方の支援記録を開く（C1008）」)
  const recordTypeOf = (s) => (s.recorder.split("／")[1] || s.heading).trim();
  function refText(r) {
    if (r.type === "scene" && sceneById[r.id]) return `${recordTypeOf(sceneById[r.id])}を開く（${r.id}）`;
    if (r.type === "unit" && unitById[r.id]) return `「${clip(unitById[r.id].text, 14)}」を開く（${r.id}）`;
    if (r.type === "raw" && rawById[r.id]) { const sc = scenes.find((x) => x.rawId === r.id); return `${sc ? recordTypeOf(sc) : "原記録"}の原文を開く（${r.id}）`; }
    return r.id;
  }

  function renderHome() {
    if (role() === "本人") { location.replace(`#/p/${PID}/v3`); return; }
    crumbs.innerHTML = "ホーム";
    const c = cycleState();
    const info = M.info;
    app.innerHTML = `
      <h1 class="page-title">ホーム</h1>
      <h2 class="section-title">担当事例</h2>
      <div class="home-grid">
        <section class="card case-card" aria-labelledby="caseP001h">
          <h3 id="caseP001h">P001 <span class="badge mock">シード・架空</span></h3>
          <p class="case-now"><span class="case-k">現在</span>${esc(PHASE_PLAIN[c.now])}</p>
          <p class="case-next"><span class="case-k">次にすること</span><a href="${detailHref("practice", "record")}">実践を記録</a></p>
          ${stepperHtml()}
          <a class="btn primary case-open" href="#/p/${PID}" aria-describedby="caseP001d">P001の会議・記録を開く</a>
          <p class="note" id="caseP001d">問い・振り返り・日常で試したこと・ライフストーリーを、1つの画面で見られます。</p>
          <details class="case-counts"><summary>件数の詳細</summary>
            <dl class="kv">
              <dt>次の会議</dt><dd>未設定 <span class="muted">（目安：前回の会議から2〜4週後）</span></dd>
              <dt>余韻の書き足し待ち</dt><dd>${pendingAfterglow()} 件</dd>
              <dt>試行の中止</dt><dd>${events().filter((e) => e.stopped).length} 件</dd>
              <dt>意思確認の期限</dt><dd>未登録</dd>
              <dt>判定していない候補</dt><dd>${pendingCands()} 件</dd>
            </dl>
          </details>
        </section>
      </div>
      <h2 class="section-title">今後の予定</h2>
      <div class="card"><div>次の会議の日は、まだ決まっていません。<a href="${detailHref("next", "task-next-meeting")}">次にすることで日を決める</a></div>
        <div class="note" style="margin-top:6px">前回: ${esc(info["会議ID"])}（模擬）・焦点「${esc(info["主題"])}」</div></div>
      <p class="note">並び順は次の予定日順です。本人の状態の良し悪しで並べ替えたり色分けしたりはしません（P-7）。</p>`;
  }

  // ---------- dashboard (F-0.2): A4 one-page overview + detail pages ----------
  const QN = ["", "①", "②", "③"];
  const DETAILS = [
    { id: "questions", name: "② 3つの問い" },
    { id: "reflection", name: "③ 振り返り" },
    { id: "practice", name: "④ 日常で試したことを記録" },
    { id: "awareness", name: "⑤ 気づき・未確認" },
    { id: "health", name: "身体と医療の経過" },
    { id: "next", name: "次にすること" },
  ];
  const detailHref = (id, anchor = "", extra = "") => `#/p/${PID}/d/${id}${anchor || extra ? "?" : ""}${anchor ? `at=${anchor}` : ""}${anchor && extra ? "&" : ""}${extra}`;
  const WHATIF_PLAIN = { "W-stay": "今のまま", "W-change": "変えた場合", "W-confirm": "確かめること" };
  const firstSentence = (t, n = 48) => clip(String(t || "").replace(/^【[^】]*】/, "").split("。")[0] + "。", n);

  function dashCtx() {
    const sum = by(M.summary, "項目ID");
    const qs = M.questions;
    const qState = (n) => {
      const v = store.d.qStatus[n];
      if (v) return typeof v === "string" ? { v, at: "" } : v;
      return { v: qs.find((q) => +q["問ID"] === n)["入力種別"] === "模擬編集" ? "編集済" : "未レビュー", at: "", initial: true };
    };
    const hyps = (sum["F-uncertainty"]["内容"].match(/[①②③④⑤]([^①②③④⑤]+?)(?=\s*[①②③④⑤]|。|$)/g) || []).map((h) => h.trim());
    const evs = events();
    const reactions = Object.values(store.d.personReactions || {});
    const recent = new Set(scenes.filter((x) => yearOf(x.date) >= 2019).map((x) => x.id));
    const vp = S.viewpoints.map((v) => ({ ...v, n: S.evidence.filter((e) => e.viewpoint === v.id && recent.has(e.sceneId)).length }));
    return { sum, qs, qState, hyps, evs, reactions, vp, plans: store.d.plans || [] };
  }
  const nextDateText = (sum) => (sum["F-nextDate"]["内容"] && sum["F-nextDate"]["内容"] !== "None" ? sum["F-nextDate"]["内容"] : "未設定");

  // ----- 今確認すること (concrete tasks behind the awareness counts) -----
  function checkItems(c) {
    const selfQ = S.units.flatMap((u) => (u.quotes || []).filter((q) => q.speaker === "本人").map((q) => ({ ...q, unit: u.id, sceneId: u.sceneId })));
    const unknownQ = S.units.flatMap((u) => (u.quotes || []).filter((q) => q.speaker === "不明").map((q) => ({ ...q, unit: u.id, sceneId: u.sceneId })));
    const low = c.vp.reduce((a, b) => (b.n < a.n ? b : a));
    const hp = healthPending();
    return [
      ...(hp.length ? [{ id: "health", text: "身体サインの受診・対応を確かめる（気持ちの解釈を待たずに）", n: hp.length, items: hp.map((sid) => ({ sceneId: sid, label: `${fmtDate(sceneById[sid].date)} ${clip(bodyByScene[sid].map((b) => b.text).join(" "), 40)}`, sub: "", href: detailHref("health", `h-${sid}`), linkText: `${recordTypeOf(sceneById[sid])}の受診・対応を記録する（${sid}）` })) }] : []),
      { id: "self", text: "本人の表現の候補を、本人と支援者で確かめる", n: selfQ.length, items: selfQ.map((q) => ({ sceneId: q.sceneId, label: `「${q.text}」`, sub: q.unit })) },
      { id: "unknown", text: "発言者が分からない引用の発言者を、記録を書いた人に確かめる", n: unknownQ.length, items: unknownQ.map((q) => ({ sceneId: q.sceneId, label: `「${q.text}」`, sub: q.unit })) },
      { id: "words", text: "管理の言葉で書かれた記録を、本人の側から読み直す", n: mgmtUnits().length, items: mgmtUnits().map((u) => { const w = u.text.match(MGMT_RE)[0]; return { sceneId: u.sceneId, label: `「${MGMT_SHOW[w] || w}」：${clip(u.text, 40)}`, sub: u.id }; }) },
      { id: "noact", text: "行動だけが書かれ、支援者の声かけや環境の工夫が書かれていない場面に書き足す", n: noEngageScenes().length, items: noEngageScenes().map((x) => ({ sceneId: x.id, label: `${fmtDate(x.date)} ${clip(x.text, 40)}`, sub: "" })) },
      { id: "viewpoint", text: `記述が少ない観点について話し合う：${low.question}`, code: `観点 ${low.id} ${low.name}`, n: low.n, items: [...new Set(S.evidence.filter((e) => e.viewpoint === low.id).map((e) => e.sceneId))].map((sid) => ({ sceneId: sid, label: clip(sceneById[sid].text, 40), sub: "" })) },
      { id: "cands", text: "自動で抜き出した候補を、確定・修正・棄却に振り分ける", n: pendingCands(), items: [...new Set(S.candidates.map((x) => x.sceneId))].map((sid) => ({ sceneId: sid, label: `${recordTypeOf(sceneById[sid])}（${fmtDate(sceneById[sid].date)}）`, sub: `${S.candidates.filter((x) => x.sceneId === sid).length}件` })) },
    ];
  }

  // --- full panels (detail pages) ---
  function qStateNote(n, stt) {
    if (stt.initial) return `<p class="q-state">状態：<b>${esc(stt.v)}</b>（会議で編集された模擬の問い）</p>`;
    const undo = `問い${QN[n]}の${stt.v}を取り消す`;
    const d = stt.at ? new Date(stt.at) : null, two = (x) => String(x).padStart(2, "0");
    const when = d ? `${d.getFullYear()}.${two(d.getMonth() + 1)}.${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}` : "";
    return `<p class="q-state" role="status">状態：<b>${esc(stt.v)}</b>${when ? `（${when} に変更）` : ""}。元に戻すには「${undo}」を押してください。</p>
      <button class="btn small" data-qundo="${n}">${undo}</button>`;
  }
  function questionsFull(c) {
    return c.qs.map((q) => {
      const n = +q["問ID"];
      const refs = questionRefs(n);
      const stmts = M.statements.filter((x) => +x["問い番号"] === n);
      const stt = c.qState(n);
      return `<section class="qsec ${st.focusQ === n ? "active" : ""}" id="q${n}" aria-labelledby="qh${n}">
        <p class="q-kind">問い${QN[n]}・${esc(q["種類"])} <span class="badge mock">模擬</span></p>
        <h2 class="q-title" id="qh${n}">${esc(q["場面別の問い"])}</h2>
        <div class="q-groups">
          <section aria-labelledby="qa${n}"><h3 id="qa${n}">この問いのねらい</h3><p>${esc(q["設計上の目的"])}。問いは正解へ誘導しません。</p></section>
          <section aria-labelledby="qb${n}"><h3 id="qb${n}">もとの記録（根拠）</h3><div class="refs">${refs.map((r) => refChip(r).replace("<span ", `<span data-crumb="問い${n}" `)).join("")}</div></section>
          <section aria-labelledby="qc${n}"><h3 id="qc${n}">会議で出た見方（${stmts.length}件）</h3>
            <p><a href="${detailHref("reflection", "statements", `q=${n}`)}">問い${QN[n]}の見方を振り返りで読む</a></p></section>
          <section aria-labelledby="qd${n}"><h3 id="qd${n}">状態と操作</h3>
            ${qStateNote(n, stt)}
            <div class="q-actions">
              <button class="btn small" data-qset="${n}" data-v="採用" aria-pressed="${stt.v === "採用"}">問い${QN[n]}を採用</button>
              <button class="btn small" data-qset="${n}" data-v="却下" aria-pressed="${stt.v === "却下"}">問い${QN[n]}を却下</button>
              <button class="btn small" data-qfocus="${n}" aria-pressed="${st.focusQ === n}">問い${QN[n]}を図で強調</button>
            </div></section>
        </div>
      </section>`;
    }).join("") + `<p class="note">採否と変更の時刻を残します。採否はいつでも取り消せます（F-4）。</p>
      <details class="box q-views"><summary>問いを考えるときの視点</summary><ul>
        <li><b>二つの苦労：</b>本人が強いられている苦労を、取り除けているか。本人の希望の中にある苦労や失敗の機会を、先回りして奪っていないか。</li>
        <li><b>体験の機会：</b>外出・遊び・人との関わりなど、いろいろな体験の機会が、時期によってどう変わったか（ライフストーリーの社会制度・生活の場と重ねる）。</li>
        <li><b>暮らしの根っこ：</b>寝る・食べる・お風呂の時刻や順番を、だれの都合で決めているか。</li>
        <li><b>本人から始める：</b>「どこで過ごすか」の前に、「だれと、どのように過ごしたいか」。</li>
      </ul></details>`;
  }
  function reflectionFull(c, params = {}) {
    const { sum, hyps, evs } = c;
    const qf = params.q ? +params.q : st.revQ || 0, who = params.who || st.revWho || "";
    st.revQ = qf; st.revWho = who;
    const people = [...new Map(M.statements.map((x) => [x["参加者ID"], x["氏名"]])).entries()];
    const list = M.statements.filter((x) => (!qf || +x["問い番号"] === qf) && (!who || x["参加者ID"] === who));
    const focus = sceneById[M.info["場面ID"]];
    const fact = sum["F-confirmed"]["内容"];
    return `
      <p class="lead-link"><a href="#/p/${PID}/v2?focus=${focus.id}">${esc(recordTypeOf(focus).replace(/の支援記録$/, ""))}の記録を開く（${focus.id}）</a> <span class="note">会議の焦点：${esc(M.info["主題"])}</span></p>
      <section class="box" aria-labelledby="rf1"><h2 class="box-h" id="rf1">確認できる事実 <span class="badge">原記録にもとづく</span> <span class="badge mock">模擬整理</span></h2>
        <p class="gist">${esc(firstSentence(fact, 80))}</p>
        <details><summary>全文を読む</summary><p>${esc(fact)}</p></details></section>
      <section aria-labelledby="rf2"><h2 class="sub-h" id="rf2">現在の仮説（併存させて保持・多数決で決めない）</h2>
        ${hyps.map((h, i) => `<div class="hyp"><b>H${i + 1}</b><span style="flex:1">${esc(h.replace(/^[①②③④⑤]/, ""))}</span><span class="badge">保留</span></div>`).join("")}
        <details><summary>補足を読む</summary><p>${esc(sum["F-uncertainty"]["内容"].split("。").slice(1).join("。"))}</p></details>
        <p class="note">仮説に合わなかったこと：${(store.d.misreadings || []).length}件 <a href="${detailHref("practice", "misread")}">読み違いと関わり直しを見る</a></p></section>
      <div class="two-col" style="margin-top:10px" id="afterglow">
        <section class="box" aria-labelledby="rf3"><h2 class="box-h" id="rf3">その後の本人の様子（余韻）</h2>${evs.filter((e) => e.afterPerson).map((e) => `<div>${fmtDate(e.date)} ${esc(e.afterPerson)}</div>`).join("") || '<div class="empty">まだ記録がありません</div>'}</section>
        <section class="box" aria-labelledby="rf4"><h2 class="box-h" id="rf4">支援者自身に残ったこと（余韻）</h2>${evs.filter((e) => e.afterSupporter).map((e) => `<div>${fmtDate(e.date)} ${esc(e.afterSupporter)}</div>`).join("") || '<div class="empty">まだ記録がありません</div>'}</section>
      </div>
      <section class="box" style="margin-top:10px" id="person" aria-labelledby="rf5"><h2 class="box-h" id="rf5">本人の振り返り（本人と見た画面での反応）</h2>${personReactionsHtml()}</section>
      <section id="statements" aria-labelledby="rf6">
        <h2 class="sub-h" id="rf6">会議で出た見方 <span class="badge mock">模擬</span></h2>
        <form class="filters" id="revFilter" aria-label="見方を絞り込む">
          <label>問い <select name="q"><option value="0">すべての問い</option>${[1, 2, 3].map((n) => `<option value="${n}" ${qf === n ? "selected" : ""}>問い${QN[n]}</option>`).join("")}</select></label>
          <label>発言者 <select name="who"><option value="">すべての人</option>${people.map(([id, name]) => `<option value="${id}" ${who === id ? "selected" : ""}>${esc(name)}（${esc(participantById[id]?.["議論上の視点"] || "")}）</option>`).join("")}</select></label>
          <span class="note" role="status">${list.length}件を表示</span>
        </form>
        ${list.map((x) => {
          const pi = M.participants.findIndex((pp) => pp["参加者ID"] === x["参加者ID"]);
          return `<article class="stmt"><span class="pdot" style="background:${PART_COLORS[pi] || "var(--muted)"}" aria-hidden="true"></span><div>
            <div class="who">${esc(x["氏名"])}（${esc(participantById[x["参加者ID"]]?.["議論上の視点"] || x["役割"])}）・${esc(x["発言の種類"])}・問い${QN[+x["問い番号"]]}</div>
            <p class="gist">${esc(firstSentence(x["発言内容"], 60))}</p>
            <details><summary>全文と根拠を読む</summary><p>${esc(x["発言内容"])}</p>
              <div class="refs">${parseRefs(x["根拠・未確認事項"]).map((r) => refChip(r).replace("<span ", `<span data-crumb="発言${x["発言ID"]}" `)).join("")}</div>
              <p class="note">根拠・未確認事項：${esc(x["根拠・未確認事項"])}</p></details></div></article>`;
        }).join("") || '<p class="empty">この条件に合う見方はありません。</p>'}
      </section>`;
  }
  function whatifHtml(editable) {
    return `<div class="whatif-row">${M.whatif.map((w) => `<section class="whatif" aria-labelledby="wf-${w["シナリオID"]}">
        <h3 id="wf-${w["シナリオID"]}">${esc(WHATIF_PLAIN[w["シナリオID"]] || w["観点"])}</h3>
        <p class="gist">${esc(firstSentence(w["内容"], 46))}</p>
        <details><summary>詳しく${editable ? "（書き直す）" : ""}<span class="sr-only">（${esc(WHATIF_PLAIN[w["シナリオID"]] || "")}）</span></summary>
          ${editable ? `<textarea name="${w["シナリオID"]}" rows="4" aria-label="${esc(WHATIF_PLAIN[w["シナリオID"]] || w["観点"])}の内容">${esc(w["内容"])}</textarea>` : `<p>${esc(w["内容"])}</p>`}
          <span class="badge">${esc(w["検証状況"])}</span></details>
      </section>`).join("")}</div>`;
  }
  function misreadHtml(c) {
    const ms = store.d.misreadings || [];
    const basisOpts = [...c.hyps.map((h, i) => `仮説 H${i + 1}：${clip(h.replace(/^[①②③④⑤]/, ""), 30)}`), ...c.plans.map((pl) => `試行計画 ${pl.id}：${clip(pl.change, 30)}`), "試行計画 P1（模擬案）", "その他（補足に書く）"];
    return `<section id="misread" tabindex="-1" aria-labelledby="mrh"><h2 class="sub-h" id="mrh">読み違いと関わり直し（${ms.length}件）</h2>
      <p class="note">仮説や関わりが、本人の反応に合わなかったことを残します。失敗を責めるためではなく、本人への理解を深める材料です。人事評価には使いません（P-7, P-12）。</p>
      ${ms.map((m) => `<div class="evt-item"><b>${fmtDate(m.date)}</b>（${esc(m.id)}・気づいた人 ${esc(m.who)}）
        <div>元の仮説・関わり: ${esc(m.basis)}${m.basisText ? `（${esc(m.basisText)}）` : ""}</div><div>合わなかった本人の反応: ${esc(m.reaction)}</div>
        ${m.changed ? `<div>変えた条件: ${esc(m.changed)}</div>` : ""}${m.reengage ? `<div>関わり直した内容とその後: ${esc(m.reengage)}</div>` : ""}</div>`).join("") || '<div class="empty">まだ記録がありません。</div>'}
      <details class="card-like"><summary>読み違いを記録する</summary>
        <form class="evt" id="misForm">
          <label>元の仮説・関わり<select name="basis">${basisOpts.map((o) => `<option>${esc(o)}</option>`).join("")}</select></label>
          <label>補足（任意）<input name="basisText"></label>
          <label>合わなかった本人の反応（示した言葉や動き）<textarea name="reaction" rows="2" required></textarea></label>
          <label>気づいた日<input type="date" name="date" required value="2026-11-08"></label>
          <label>気づいた人<input name="who" required placeholder="例: 西田"></label>
          <label>変えた条件<input name="changed" placeholder="例: 配膳前の待ち時間を短くした"></label>
          <label>関わり直した内容とその後<textarea name="reengage" rows="2"></textarea></label>
          <button class="btn primary" type="submit">記録する</button>
        </form></details></section>`;
  }
  function practiceFull(c) {
    const { sum, evs } = c;
    return `
      <details class="card-like" id="record" open><summary><b>日常で試したことを記録する</b>（1.5回目）</summary>
        <form class="evt" id="evtForm">
          <label>試した日<input type="date" name="date" value="2026-11-05" required></label>
          <label>支援・環境を何から何へ変えたか<input name="change" required placeholder="例: 夕方の配膳前に、写真帳と休息を選べる形で示した"></label>
          <label>支援者がかけた言葉（実際の言い方）<input name="words" placeholder="例: 「写真帳と休けい、どっちにする？」"></label>
          <label>本人が表したこと（言葉・視線・身振りをそのまま）<textarea name="expression" rows="2" required placeholder="印象語ではなく、示した言葉や動きをそのまま" aria-describedby="exprWarn"></textarea></label>
          <p class="field-warn" id="exprWarn" role="status"></p>
          <label>本人の拒否・ためらいと、それへの応じ方（あれば）<textarea name="hesitation" rows="2" placeholder="例: 手を引っこめた → 誘うのをやめ、5分後にもう一度たずねた"></textarea></label>
          <label><span><input type="checkbox" name="stopped"> 拒否・苦痛があり中止した</span></label>
          <button class="btn primary" type="submit">記録する</button>
        </form>
      </details>
      <h2 class="sub-h">これまでの記録（試した ${evs.filter((e) => !e.stopped).length}件 ／ 中止 ${evs.filter((e) => e.stopped).length}件）</h2>
      ${evs.length ? evs.map((e) => `<div class="evt-item"><b>${fmtDate(e.date)}</b>（${esc(e.id)}） ${e.stopped ? '<span class="badge stop">中止</span>' : '<span class="badge">試した</span>'}
          <div>変えたこと: ${esc(e.change)}</div>${e.words ? `<div>かけた言葉: ${esc(e.words)}</div>` : ""}<div>本人が表したこと: ${esc(e.expression)}</div>${e.hesitation ? `<div>拒否・ためらいと応じ方: ${esc(e.hesitation)}</div>` : ""}
          ${e.afterPerson || e.afterSupporter ? "" : `<button class="btn small" data-after="${e.id}">${fmtDate(e.date)} の実践に余韻を書き足す</button>`}</div>`).join("") : '<div class="empty">まだ記録がありません。上の欄から記録できます。</div>'}
      <h2 class="sub-h">いま試している計画</h2>
      ${c.plans.map((pl) => `<div class="box" style="margin-bottom:8px"><h3 class="box-h">試行計画 ${esc(pl.id)} <span class="badge ok">会議 ${esc(pl.meeting)} で作成</span></h3>
        <div><b>何を何から何へ:</b> ${esc(pl.change)}</div><div><b>担当・場面:</b> ${esc(pl.owner)} ／ ${esc(pl.scene)} ／ ${esc(pl.when)}</div>
        <div><b>止める条件:</b> ${esc(pl.stop)}</div><div class="note">余韻の確認: ${esc(pl.afterglowDate || "未設定")} ／ 本人の意思確認: ${esc(pl.consent)}</div></div>`).join("")}
      <div class="box"><h3 class="box-h">試行計画 P1 <span class="badge mock">模擬案</span></h3><p class="gist">${esc(firstSentence(sum["F-nextAction"]["内容"], 60))}</p>
        <details><summary>全文を読む</summary><p>${esc(sum["F-nextAction"]["内容"])}</p><p class="note">本人と確かめる方法: ${esc(sum["F-askPerson"]["内容"])}</p></details></div>
      ${misreadHtml(c)}
      <h2 class="sub-h">支援を変えた場合を考える</h2>
      ${whatifHtml(false)}
      <h2 class="sub-h">4観点 はじめ → いま <span class="badge">スコアなし</span></h2>
      <table class="plain"><thead><tr><th scope="col">観点</th><th scope="col">はじめ</th><th scope="col">いま</th><th scope="col">根拠・未確認</th></tr></thead><tbody>
        ${["安心", "表現", "選択", "拡大"].map((a) => `<tr><th scope="row">${a}</th><td class="muted">未記録</td><td class="muted">振り返りの会議で記入</td><td class="muted">—</td></tr>`).join("")}
        <tr><th scope="row">その他の大切な変化</th><td class="muted" colspan="3">例：誘いを断れたか・途中で休めたか・何もしない日にも周りとの関係と居場所が続いたか</td></tr>
      </tbody></table>
      <details><summary>観察するときの手がかり（模擬）</summary><p>${esc(sum["F-indicator"]["内容"])}</p></details>`;
  }
  const LIST_GUIDE = {
    health: `<p class="note">原因は断定しません。ただし「原因が分からない」ことは、確かめない理由にしません（P-11）。</p>`,
    words: `<p>この言葉の奥にあることを、次の問いで読み直してください。言葉を使ってはいけない、という意味ではありません。</p><ul class="guide-qs">${MGMT_QS.map((q) => `<li>${q}</li>`).join("")}</ul><p class="note">言葉の一覧は試作の仮のものです。現場の職員・ピアと作ります（U-20）。</p>`,
    noact: `<p class="note">自動で拾った候補です。行動の前後で、支援者がかけた言葉・用意した条件・環境を書き足すと、本人の困りごとや願いを読み取りやすくなります（P-12）。</p>`,
  };
  function awarenessFull(c, params = {}) {
    const items = checkItems(c);
    const sel = items.find((x) => x.id === params.list);
    const max = Math.max(...c.vp.map((v) => v.n), 1);
    return `
      <section aria-labelledby="aw1"><h2 class="sub-h" id="aw1">今確認すること</h2>
        <ol class="checks">${items.map((x) => `<li><span class="check-text">${esc(x.text)}${x.code ? ` <span class="note">（${esc(x.code)}）</span>` : ""}</span>
          <span class="check-n">${x.n}件</span> <a class="btn small" href="${detailHref("awareness", "list", `list=${x.id}`)}">対象の一覧を開く<span class="sr-only">（${esc(x.text)}）</span></a></li>`).join("")}</ol>
      </section>
      ${sel ? `<section class="box" id="list" tabindex="-1" aria-labelledby="awl"><h2 class="box-h" id="awl">対象の一覧：${esc(sel.text)}（${sel.items.length}件）</h2>
        ${LIST_GUIDE[sel.id] || ""}
        <ul class="target-list">${sel.items.slice(0, 80).map((it) => `<li>${esc(it.label)} <span class="note">${esc(it.sub || "")}</span> <a href="${it.href || `#/p/${PID}/v2?focus=${it.sceneId}`}">${esc(it.linkText || `${recordTypeOf(sceneById[it.sceneId])}を文章で読む（${it.sceneId}）`)}</a></li>`).join("")}</ul>
        ${sel.items.length > 80 ? `<p class="note">先頭の80件を表示しています。</p>` : ""}</section>` : ""}
      <section aria-labelledby="aw2"><h2 class="sub-h" id="aw2">見立ての観点ごとの記述（2019年以降の記録）</h2>
        <div class="bars">${c.vp.map((v) => `<div class="row" data-vp="${v.id}" data-tip="${esc(`<b>${esc(v.name)}（${esc(v.id)}）</b><br>${esc(v.definition)}<br>考える問い: ${esc(v.question)}<br><span class='muted'>限界: ${esc(v.limit)}</span>`)}"><span>${esc(v.name)} <span class="note">（${v.id}）</span></span><span class="track"><span class="fill" style="width:${(v.n / max) * 100}%"></span></span><span class="val">${v.n}</span></div>`).join("")}</div>
        <p class="note">件数は、技能の高低や因果を示すものではありません。振り返りの手がかりです。</p></section>`;
  }
  function healthCard(sid) {
    const x = sceneById[sid], h = healthOf(sid) || {}, bs = bodyByScene[sid];
    const v = (k) => esc(h[k] || "");
    return `<section class="box health-card" aria-labelledby="hh-${sid}">
      <h3 class="box-h" id="hh-${sid}">${fmtDate(x.date)} ${esc(recordTypeOf(x))}（${sid}） <span class="badge ${h.status === "対応済み" ? "ok" : ""}">${esc(h.status || "未確認")}</span></h3>
      <p class="note">記録にある身体サイン <span class="badge">自動の候補・要確認</span></p>
      <ul class="body-signs">${bs.map((b) => `<li>${esc(b.text)} <span class="note">（${esc(b.kind)}）</span></li>`).join("")}</ul>
      ${h.status ? `<dl class="kv health-kv">
        <dt>確認した人・日</dt><dd>${v("who")}（${fmtDate(h.date)}）</dd>
        <dt>診断名</dt><dd>${v("diagnosis") || '<span class="muted">記入なし</span>'}</dd>
        <dt>症状</dt><dd>${v("symptom") || '<span class="muted">記入なし</span>'}</dd>
        <dt>暮らしへの影響</dt><dd>${v("impact") || '<span class="muted">記入なし</span>'}</dd>
        <dt>判断と理由</dt><dd>${v("judge") || '<span class="muted">記入なし</span>'}</dd>
        <dt>受診・精査・治療</dt><dd>${v("care") || '<span class="muted">記入なし</span>'}</dd>
        <dt>本人・家族への説明</dt><dd>${v("explain") || '<span class="muted">記入なし</span>'}</dd>
      </dl>` : ""}
      <p><a href="#/p/${PID}/v2?focus=${sid}">${esc(recordTypeOf(x))}を文章で読む（${sid}）</a></p>
      <details id="h-${sid}"><summary>受診・対応の確認を${h.status ? "書き直す" : "記録する"}<span class="sr-only">（${sid}）</span></summary>
        <form class="evt health-form" data-scene="${sid}">
          <label>確認した人<input name="who" required value="${v("who")}" placeholder="例: 看護師 山口"></label>
          <label>確認した日<input type="date" name="date" required value="${v("date")}"></label>
          <label>診断名（分かれば）<input name="diagnosis" value="${v("diagnosis")}"></label>
          <label>症状（いま身体に起きていること）<textarea name="symptom" rows="2">${v("symptom")}</textarea></label>
          <label>症状が暮らしに与えている影響（食事・睡眠・排泄・移動・活動・人との関わり）<textarea name="impact" rows="2">${v("impact")}</textarea></label>
          <label>判断と理由<textarea name="judge" rows="2">${v("judge")}</textarea></label>
          <label>受診・精査・治療<input name="care" value="${v("care")}"></label>
          <label>本人・家族への説明<input name="explain" value="${v("explain")}"></label>
          <label>状態<select name="status">${HEALTH_STATUS.map((o) => `<option ${o === (h.status || "確認中") ? "selected" : ""}>${o}</option>`).join("")}</select></label>
          <button class="btn primary" type="submit">保存する</button>
        </form></details>
    </section>`;
  }
  function healthFull(params = {}) {
    const pend = healthPending();
    const all = Object.keys(bodyByScene).sort((a, b) => sceneById[a].date.localeCompare(sceneById[b].date));
    const sel = params.sel && bodyByScene[params.sel] && !pend.includes(params.sel) ? params.sel : "";
    const stateText = (id) => healthOf(id)?.status || (yearOf(sceneById[id].date) >= RECENT_YEAR ? "未確認" : `記録なし（${RECENT_YEAR}年より前）`);
    return `
      <p class="lead-note"><b>気持ちの解釈は急がずに保留できます。身体の変化と苦痛への対応は先送りしません（P-11）。</b><br>
        原因は断定しません。ただし「原因が分からない」「障害のため」は、確かめない理由にしません。</p>
      ${sel ? `<section aria-labelledby="hlsel"><h2 class="sub-h" id="hlsel">選んだ場面</h2>${healthCard(sel)}</section>` : ""}
      <section aria-labelledby="hl1"><h2 class="sub-h" id="hl1">受診・対応を確かめるもの（${RECENT_YEAR}年以降の記録・${pend.length}件）</h2>
        ${pend.length ? pend.map(healthCard).join("") : '<p class="empty">いま確かめるものはありません。</p>'}</section>
      <section aria-labelledby="hl2"><h2 class="sub-h" id="hl2">これまでの身体サインの記録（${all.length}場面）</h2>
        <div class="table-wrap"><table class="plain"><caption class="sr-only">身体サインのある場面と、受診・対応の確認の状態</caption>
          <thead><tr><th scope="col">日付</th><th scope="col">記録</th><th scope="col">身体サインの候補</th><th scope="col">確認の状態</th><th scope="col">操作</th></tr></thead>
          <tbody>${all.slice().reverse().map((id) => `<tr id="hrow-${id}"><td>${fmtDate(sceneById[id].date)}</td><td>${esc(recordTypeOf(sceneById[id]))}</td>
            <td>${esc([...new Set(bodyByScene[id].map((b) => b.kind))].join("・"))}</td><td>${esc(stateText(id))}</td>
            <td><a href="${pend.includes(id) ? detailHref("health", `h-${id}`) : detailHref("health", `h-${id}`, `sel=${id}`)}">確認を記録する<span class="sr-only">（${id}）</span></a></td></tr>`).join("")}</tbody></table></div>
        <p class="note">医療情報をだれが見られるかは未決です（U-21）。この試作では、記録はこのブラウザ内にだけ保存されます。</p></section>`;
  }
  function nextFull() {
    const ts = tasks();
    return `<p class="note">することごとに「担当・確認日・状態」を1組で示します。未設定のものは「設定する」で決められます。</p>
      <div class="tasks">${ts.map((t) => taskRowHtml(t, true)).join("")}</div>`;
  }

  // --- compact tiles (A4 overview) ---
  const kv = (rows) => `<dl class="tile-kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  const tile = (cls, title, id, body, extra = "", more = "") =>
    `<section class="panel tile ${cls}" aria-labelledby="t-${id}"><div class="tile-h"><h2 id="t-${id}">${title}</h2>${extra}<a class="more" href="${detailHref(id)}">${more || `${esc(title.replace(/^[②-⑤] /, ""))}を詳しく見る`} →</a></div>${body}</section>`;
  // compact form of 次にすること for the A4 overview: one row per task, the same four items
  const taskTable = (ts) => `<table class="plain task-table"><caption class="sr-only">次にすること（上位${ts.length}件）</caption>
    <thead><tr><th scope="col">すること</th><th scope="col">担当</th><th scope="col">確認日</th><th scope="col">状態</th></tr></thead>
    <tbody>${ts.map((t) => `<tr><th scope="row">${t.href ? `<a href="${t.href}">${esc(clip(t.text, 40))}</a>` : esc(clip(t.text, 40))}</th>
      <td>${t.owner ? esc(t.owner) : `<span class="unset">未設定</span> ${taskSetup(t)}`}</td>
      <td>${t.date ? fmtDate(t.date) : `<span class="unset">未設定</span> ${taskSetup(t)}`}</td>
      <td><span class="badge ${t.status === "済" ? "ok" : ""}">${esc(t.status)}</span></td></tr>`).join("")}</tbody></table>`;

  function renderDashboard() {
    crumbs.innerHTML = `<a href="#/">ホーム</a> › P001 ケース会議ダッシュボード`;
    const info = M.info;
    const c = dashCtx();
    const { evs } = c;
    const rCount = c.reactions.reduce((m, r) => ((m[r.value] = (m[r.value] || 0) + 1), m), {});
    const stopped = evs.filter((e) => e.stopped).length;
    const open = tasks().filter((t) => t.status !== "済");
    const checks = checkItems(c);
    const focus = sceneById[info["場面ID"]];

    app.innerHTML = `
      <div class="dash-a4">
      <div class="dash-head compact">
        <h1>P001 ケース会議ダッシュボード</h1>
        ${stepperHtml()}
        <span class="note">現在：<b>${esc(PHASE_PLAIN[cycleState().now])}</b></span>
        <span class="badge mock">模擬データを含む</span>
        <span style="flex:1"></span>
        <a class="btn small no-print" href="#/p/${PID}/v3">本人と見る</a>
        <a class="btn small primary no-print" id="startMeeting" href="#/p/${PID}/meeting">会議を始める</a>
        <button class="btn small no-print" id="printBtn">A4で印刷</button>
      </div>

      <section class="panel next-strip" aria-labelledby="t-next">
        <div class="tile-h"><h2 id="t-next">次にすること</h2><span class="note">${open.length}件</span><a class="more" href="${detailHref("next")}">次にすることをすべて見る →</a></div>
        ${taskTable(open.slice(0, 3))}
      </section>

      <section class="panel story-strip" aria-labelledby="t-story">
        <div class="tile-h"><h2 id="t-story">① ライフストーリー</h2>
          <span class="note">${LAYERS.map((l) => `<span class="layer-dot ld-${l.id}" aria-hidden="true"></span> ${l.name}`).join("　")}　★ 試したこと ${evs.length}件${st.focusQ ? `　問い${QN[st.focusQ]}の根拠を強調中` : ""}</span>
          <span style="flex:1"></span>
          <a class="more" href="#/p/${PID}/v1">全体を図で見る →</a>
          <a class="more" href="#/p/${PID}/v2${st.focusQ ? `?focus=${M.questions[st.focusQ - 1]["参照場面ID"]}` : ""}">出来事を文章で読む →</a></div>
        <div class="viz mini-viz" id="miniViz"></div>
      </section>

      <section class="panel q-strip" aria-labelledby="t-questions">
        <div class="tile-h"><h2 id="t-questions">② 3つの問い</h2><span class="badge mock">模擬</span><a class="more" href="${detailHref("questions")}">3つの問いを詳しく見る →</a></div>
        <div class="q-row">
          ${c.qs.map((q) => {
            const n = +q["問ID"];
            return `<article class="qmini ${st.focusQ === n ? "active" : ""}" aria-labelledby="qm${n}">
              <h3 class="clamp2" id="qm${n}">${esc(q["場面別の問い"])}</h3>
              <p class="qtype">問い${QN[n]}・${esc(q["種類"].replace("ための問い", "問い"))}・<span class="badge">${esc(c.qState(n).v)}</span></p>
              <div class="qmini-foot">
                <button class="btn small" data-qfocus="${n}" aria-pressed="${st.focusQ === n}">問い${QN[n]}を図で強調</button>
                <a class="btn small" href="${detailHref("questions", "q" + n)}">問い${QN[n]}を開く</a></div>
            </article>`;
          }).join("")}
        </div>
      </section>

      <div class="tile-row three">
        ${tile("t-rev", "③ 振り返り", "reflection", `<p class="tile-lead"><a href="#/p/${PID}/v2?focus=${focus.id}">${esc(recordTypeOf(focus).replace(/の支援記録$/, ""))}の記録を開く（${focus.id}）</a></p>` + kv([
          ["仮説", `${c.hyps.length}つ（すべて保留）`],
          ["本人の反応", c.reactions.length ? Object.entries(rCount).map(([k, v]) => `${esc(k)} ${v}`).join("・") : '<span class="muted">まだなし</span>'],
          ["会議の見方", `${M.statements.length}件`],
        ]))}
        ${tile("t-prac", "④ 日常で試したことを記録", "practice", kv([
          ["いまの計画", `<span class="clamp1">${esc(tasks()[0]?.text || "")} ほか</span> <span class="muted">（P1 模擬案${c.plans.length ? `＋${c.plans.length}件` : ""}）</span>`],
          ["記録", `試した ${evs.length - stopped}件・中止 ${stopped}件${stopped ? ' <span class="badge stop">中止あり</span>' : ""}`],
        ]) + `<p class="tile-lead"><a class="btn small primary" href="${detailHref("practice", "record")}">日常で試したことを記録する</a></p>`, "", "これまでの記録を見る")}
        ${tile("t-aware", "⑤ 気づき・未確認", "awareness", `<p class="tile-sub">今確認すること</p><ul class="check-mini">${checks.slice(0, 2).map((x) => `<li><span class="clamp1">${esc(x.text)}</span> <a href="${x.id === "health" ? detailHref("health") : detailHref("awareness", "list", `list=${x.id}`)}">${x.n}件の一覧<span class="sr-only">（${esc(x.text)}）</span></a></li>`).join("")}</ul>
          <p class="tile-lead"><a href="${detailHref("health")}">身体と医療の経過を開く</a> <span class="note">（確かめるもの ${healthPending().length}件）</span></p>`)}
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
    const body = { questions: () => questionsFull(c), reflection: () => reflectionFull(c, params), practice: () => practiceFull(c), awareness: () => awarenessFull(c, params), health: () => healthFull(params), next: () => nextFull() }[d.id]();
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
    bindPanelEvents(kind, params);
    if (params.at) { const el = document.getElementById(params.at); if (el) { if (el.tagName === "DETAILS") el.open = true; el.querySelector("details")?.setAttribute("open", ""); el.scrollIntoView({ block: "start" }); (el.matches("[tabindex]") ? el : el.querySelector("summary, button, input, a") || el).focus?.({ preventScroll: true }); } }
    document.title = `P001 ${d.name} — TOMONI（試作）`;
  }

  function bindPanelEvents(kind, params = {}) {
    const rerender = (focusSel) => { kind ? renderDetail(kind, { ...params, at: "" }) : render(true); if (focusSel) app.querySelector(focusSel)?.focus(); };
    app.querySelectorAll("[data-qfocus]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const n = +b.dataset.qfocus; st.focusQ = st.focusQ === n ? null : n; rerender(`[data-qfocus="${n}"]`); announce(st.focusQ ? `問い${QN[n]}の根拠を図で強調しています。もう一度押すと解除します` : `問い${QN[n]}の強調を解除しました`); }));
    app.querySelectorAll("[data-qset]").forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const n = b.dataset.qset;
      store.d.qStatus[n] = { v: b.dataset.v, at: new Date().toISOString() }; store.save();
      rerender(`[data-qundo="${n}"]`);
      announce(`問い${QN[n]}を「${b.dataset.v}」にしました。取り消すには「問い${QN[n]}の${b.dataset.v}を取り消す」を押してください`);
    }));
    app.querySelectorAll("[data-qundo]").forEach((b) => (b.onclick = () => { const n = b.dataset.qundo; delete store.d.qStatus[n]; store.save(); rerender(`[data-qset="${n}"]`); announce(`問い${QN[n]}を元の状態に戻しました`); }));
    app.querySelectorAll("[data-after]").forEach((b) => (b.onclick = () => afterglowForm(b.dataset.after)));
    app.querySelectorAll("[data-vp]").forEach((r) => { r.onmousemove = (e) => showTip(r.dataset.tip, e); r.onmouseleave = hideTip; });
    const rf = $("#revFilter");
    if (rf) rf.onchange = (e) => { const fd = new FormData(rf); st.revQ = +fd.get("q"); st.revWho = fd.get("who"); renderDetail("reflection", { at: "" }); app.querySelector(`#revFilter [name="${e.target.name}"]`)?.focus(); announce(`見方を絞り込みました`); };
    app.querySelectorAll(".task-form").forEach((f) => (f.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(f), id = f.dataset.task;
      (store.d.tasks ||= {})[id] = { owner: fd.get("owner").trim(), date: fd.get("date"), status: fd.get("status") };
      store.save(); st.taskEdit = null;
      renderDetail("next", { at: "" }); document.querySelector(`#task-${id} summary`)?.focus();
      announce("担当・確認日・状態を保存しました");
    }));
    app.querySelectorAll(".health-form").forEach((hf) => (hf.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(hf), sid = hf.dataset.scene;
      (store.d.health ||= {})[sid] = Object.fromEntries(["who", "date", "diagnosis", "symptom", "impact", "judge", "care", "explain", "status"].map((k) => [k, String(fd.get(k) || "").trim()]));
      store.save(); rerender();
      (app.querySelector(`#h-${sid} summary`) || app.querySelector(`#hrow-${sid} a`))?.focus();
      announce(`受診・対応の確認を記録しました（${sid}・状態：${fd.get("status")}）`);
    }));
    const ex = app.querySelector('#evtForm [name="expression"]');
    if (ex) ex.oninput = () => { const w = expressionWarning(ex.value); const el = $("#exprWarn"); if (el.textContent !== w) el.textContent = w; };
    const mf = $("#misForm");
    if (mf) mf.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(mf), ms = (store.d.misreadings ||= []);
      ms.push({ id: `MR${ms.length + 1}`, ...Object.fromEntries(["basis", "basisText", "reaction", "date", "who", "changed", "reengage"].map((k) => [k, String(fd.get(k) || "").trim()])), at: new Date().toISOString() });
      store.save(); rerender("#misread"); announce("読み違いと関わり直しを記録しました");
    };
    const f = $("#evtForm");
    if (f) f.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      store.d.events.push({
        id: `E${store.d.events.length + 1}`, date: fd.get("date"), change: fd.get("change"),
        expression: fd.get("expression"), words: (fd.get("words") || "").trim(), hesitation: (fd.get("hesitation") || "").trim(),
        stopped: !!fd.get("stopped"), plan: "P1", at: new Date().toISOString(),
      });
      store.save(); rerender("#evtForm button"); announce("日常で試したことを記録しました");
    };
  }

  function personReactionsHtml() {
    const rs = Object.entries(store.d.personReactions || {});
    if (!rs.length) return '<div class="empty">まだ回答がありません。「いまは みない／こたえない」も回答として尊重します。</div>';
    return rs.map(([id, r]) => `<div><span class="chip" role="button" tabindex="0" data-ref-type="scene" data-ref-id="${id}">${esc(refText({ type: "scene", id }))}</span> 本人: <b>${esc(r.value)}</b>
      <span class="note">${esc(fmtDate(r.at.slice(0, 10)))}・手伝った人 ${esc(r.helper || "なし")}・方法 ${esc(r.method || "—")}</span></div>`).join("") +
      '<p class="note">本人の回答は、試行や研究記録への同意の代わりにはしません（FR-10.5）。</p>';
  }
  function afterglowForm(id) {
    const e = store.d.events.find((x) => x.id === id);
    pushDrawer(`余韻 ${id}`, () => afterglowForm(id), `
      <h3>その後の様子と余韻を書き足す（${fmtDate(e.date)}・${esc(id)}）</h3>
      <p class="note">本人のその後の表現と、支援者自身の余韻を分けて書きます。支援者の余韻を、本人の感覚の証拠として扱いません。</p>
      <form class="evt" id="afterForm">
        <label>その後、本人が表したこと・生活に見られたこと（表情、身体の緊張、近づく・離れる、選んだこと、食事・睡眠の様子）<textarea name="afterPerson" rows="3"></textarea></label>
        <label>支援者自身に残ったこと（驚き・安心・戸惑い・違和感）<textarea name="afterSupporter" rows="3"></textarea></label>
        <button class="btn primary">保存する</button>
      </form>`);
    $("#afterForm").onsubmit = (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      e.afterPerson = f.get("afterPerson"); e.afterSupporter = f.get("afterSupporter");
      store.save(); closeDrawer(); render(); announce("余韻を書き足しました");
    };
  }

  function awarenessHtml() { return awarenessFull(dashCtx(), {}); }

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
