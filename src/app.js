// 화면: 데이터 고르기 → 단계 · 장비 설정 → 실행(Worker) → 결과 · 차트 → 현장 검증(재현 · 비교 · Shadow · 전환 · 롤백)
import { SCENARIOS, FIRST_SETTINGS, clone } from "./scenarios.js";
import { merge, hashOf, diffSettings, precheck, switchState, CRITERIA, stageSet, STAGE_DEFAULT } from "./model.js";
import { validate, POLICIES } from "./engine.js";
import { sampleLog } from "./gen.js";
import * as db from "./store.js";
import { t, setLang, getLang, applyI18n, num, fmtMs, fmtDur, fmtMB, stageLabel } from "./i18n.js";
import { lineChart, histChart, seriesColor } from "./charts.js";
import { download, toCSV, toHTML } from "./export.js";

const VERSION = "1.0.0";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const DIST_TYPES = ["fixed", "normal", "lognormal", "gamma", "exp"];

const S = {
  w: null, draft: null, versions: [], activeV: 1, saved: [], log: null, last: null, records: [], repro: {},
  crit: { ...CRITERIA }, theme: "auto", latStage: 0, tab: "repro", onlyDiff: false, readOpts: {}, running: false, stale: false,
};
const active = () => (S.versions.find((v) => v.v === S.activeV) || S.versions[S.versions.length - 1]).settings;
const dataOf = (w) => ({ camera: w.camera, frameMB: +w.frameMB, baseMB: +w.baseMB, durationS: +w.durationS, seed: +w.seed, logId: w.logId || null,
  stages: w.stages.map((s) => ({ name: s.name, from: +s.from, keep: !!s.keep, dist: s.dist })) });
const widOf = (w) => hashOf(dataOf(w));
const labelOf = (w) => (w.builtin ? t(w.label) : w.label) + (w.origin && widOf(w) !== w.origin ? t("edited") : "");
const builtin = (i) => { const w = clone(SCENARIOS[i]); w.origin = widOf(w); return w; };

// ---------- Worker ----------
let worker = null, reqId = 0, sentLogs = new Set();
const pending = new Map();
function wk() {
  if (!worker) {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    sentLogs = new Set();
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      if (data.type === "progress") return p.onProgress?.(data.p);
      pending.delete(data.id);
      if (data.type === "error") p.rej(Object.assign(new Error(data.code), data)); else p.res(data);
    };
    worker.onerror = (e) => { db.logError(e.message || "worker"); for (const p of pending.values()) p.rej(new Error("E_WORKER")); pending.clear(); worker = null; };
  }
  return worker;
}
function call(msg, onProgress, transfer) {
  const id = ++reqId;
  return new Promise((res, rej) => { pending.set(id, { res, rej, onProgress }); wk().postMessage({ ...msg, id }, transfer || []); });
}
function cancelWork() {
  worker?.terminate(); worker = null;
  for (const p of pending.values()) p.rej(new Error("E_CANCELED"));
  pending.clear();
}
async function getLog(id) {
  if (S.log?.id === id) return S.log;
  return db.get("logs", id);
}
async function ensureLog(id) {
  if (!id || sentLogs.has(id)) return;
  const l = await getLog(id);
  if (!l) throw new Error("E_LOG_MISSING");
  wk().postMessage({ type: "setLog", log: { id: l.id, cols: l.cols, arrivals: l.arrivals } });
  sentLogs.add(id);
}

// ---------- 저장 ----------
let saveTimer = 0;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    db.put("kv", { w: S.w, draft: S.draft, activeV: S.activeV, crit: S.crit, theme: S.theme, latStage: S.latStage, tab: S.tab, readOpts: S.readOpts, onlyDiff: S.onlyDiff }, "state").catch(db.logError);
  }, 250);
}
const saveLast = () => db.put("kv", S.last, "last").catch(db.logError);

// ---------- 공통 ----------
function toast(msg, ms = 3200) {
  const el = $("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), ms);
}
function errText(e) {
  const code = e?.message || String(e);
  const k = "err_" + code;
  const s = t(k, { arg: e?.arg ?? "" });
  return s === k ? t("err_unknown", { msg: code }) : s;
}
const policyLabel = (p) => t("pol_" + p);
const distLabel = (d, log) => (d.type === "log" ? t(d.mode === "sample" ? "distLogSample" : "distLogReplay", { col: log?.names?.[d.col] ?? `#${d.col + 1}` }) : t("dist_" + d.type));

// ---------- 1. 데이터 ----------
function renderScenarioButtons() {
  const box = $("scenario-btns");
  const cur = S.w.builtin ? S.w.id : null;
  box.innerHTML = SCENARIOS.map((s, i) => `<button type="button" data-sc="${i}" class="${cur === s.id ? "on" : ""}" aria-pressed="${cur === s.id}">${esc(t(s.label))}</button>`).join("");
}
function openWorkload(w) {
  S.w = clone(w);
  if (!S.w.origin) S.w.origin = widOf(S.w);
  S.stale = true;
  renderAllConfig();
  saveState();
}
async function openBuiltin(i) { S.log = null; openWorkload(builtin(i)); renderLogInfo(); await run(); }

function logWorkload(log) {
  const known = { proc: -1, draw: -1, save: 0 };
  const names = log.names;
  const procIdx = names.indexOf("proc");
  const stages = names.map((n, i) => ({
    name: n,
    from: n in known && procIdx >= 0 ? (n === "save" ? procIdx : -1) : -1,
    keep: !/draw|display|render|ui|view|그리기|표시|화면/i.test(n),
    dist: { type: "log", col: i, mode: "replay" },
  }));
  // 입력 단계는 앞에 있어야 한다
  stages.forEach((s, i) => { if (s.from >= i) s.from = -1; });
  // 로그 한 바퀴 = 마지막 촬영 시각 + 평균 간격 (그래서 프레임 수가 로그 줄 수와 같다)
  const span = log.arrivals ? (log.arrivals[log.arrivals.length - 1] * log.rows) / (log.rows - 1) / 1000 : log.rows / (S.w.camera.fps || 30);
  const w = {
    id: "log-" + log.id, builtin: false, label: log.file, logId: log.id,
    camera: { ...S.w.camera, mode: log.arrivals ? "log" : S.w.camera.mode === "log" ? "fixed" : S.w.camera.mode },
    frameMB: S.w.frameMB, baseMB: S.w.baseMB, durationS: +span.toFixed(3), seed: S.w.seed, stages,
  };
  w.origin = widOf(w);
  return w;
}

function readOptsFromForm() {
  const v = (id) => $(id).value;
  S.readOpts = { delim: v("o-delim"), header: v("o-header"), encoding: v("o-enc"), time: v("o-time").trim(), timeUnit: v("o-tunit"), durUnit: v("o-dunit"), cols: v("o-cols").trim() };
  return S.readOpts;
}
function fillReadOpts() {
  const o = S.readOpts || {};
  $("o-delim").value = o.delim || "auto"; $("o-header").value = o.header || "auto"; $("o-enc").value = o.encoding || "auto";
  $("o-time").value = o.time || ""; $("o-tunit").value = o.timeUnit || "auto"; $("o-dunit").value = o.durUnit || "ms"; $("o-cols").value = o.cols || "";
}
let lastFile = null;
async function openFile(file, text) {
  lastFile = { file, text, name: file?.name || "sample-timing-log.csv" };
  const o = readOptsFromForm();
  const opts = { delim: o.delim, header: o.header === "auto" ? "auto" : o.header === "yes", time: o.time, timeUnit: o.timeUnit, durUnit: o.durUnit, cols: o.cols };
  $("parse-progress").hidden = false;
  $("log-info").innerHTML = "";
  try {
    const r = await call({ type: "parse", file: text ? undefined : file, text, encoding: o.encoding, opts });
    const log = { ...r.log, id: hashOf({ n: lastFile.name, rows: r.log.rows, s: r.log.cols.map((c) => c[0] + c[c.length - 1]) }), file: lastFile.name, fits: r.fits, ms: r.ms, at: Date.now() };
    S.log = log;
    await db.put("logs", log).catch(db.logError);
    openWorkload(logWorkload(log));
    renderLogInfo();
    await run();
  } catch (e) {
    if (e.message === "E_CANCELED") return;
    $("log-info").innerHTML = `<p class="msg err" role="alert">${esc(errText(e))}</p>`;
    if (e.bad) showBad(e.bad, e.badCount);
    db.logError(e);
  } finally { $("parse-progress").hidden = true; }
}

function showBad(bad, count) {
  const el = $("bad");
  if (!count) { el.hidden = true; return; }
  el.hidden = false;
  $("bad-sum").textContent = t("badSum", { n: num(count) });
  $("bad-body").innerHTML = `<table class="tbl"><thead><tr><th>${t("thLine")}</th><th>${t("thReason")}</th><th>${t("thText")}</th></tr></thead><tbody>` +
    bad.slice(0, 200).map((b) => `<tr><td>${b.line}</td><td>${esc(t("bad_" + b.code, { arg: b.arg }))}</td><td><code>${esc(b.text)}</code></td></tr>`).join("") +
    `</tbody></table>${count > 200 ? `<p class="hint">${t("badMore", { n: num(count - 200) })}</p>` : ""}`;
}

function renderLogInfo() {
  const L = S.w.logId && S.log?.id === S.w.logId ? S.log : null;
  const info = $("log-info"), fit = $("fit-box");
  if (!L) { info.innerHTML = ""; fit.hidden = true; $("bad").hidden = true; return; }
  const span = L.arrivals ? fmtDur(L.arrivals[L.arrivals.length - 1]) : null;
  info.innerHTML = `<div class="stat-row">
    <div class="stat"><b>${esc(L.file)}</b><span>${t("logFile")}</span></div>
    <div class="stat"><b>${num(L.rows)}</b><span>${t("logRows")}</span></div>
    <div class="stat"><b>${L.timeName ? esc(L.timeName) : "—"}</b><span>${t("logTime")}${span ? " · " + span : ""}</span></div>
    <div class="stat"><b>${L.names.map(esc).join(" · ")}</b><span>${t("logCols")}</span></div>
    <div class="stat ${L.badCount ? "warn" : ""}"><b>${num(L.badCount)}</b><span>${t("logBad")}</span></div></div>`;
  showBad(L.bad, L.badCount);
  fit.hidden = false;
  fit.innerHTML = `<h3>${t("fitTitle")} <small>${t("fitHint")}</small></h3><div class="tbl-wrap"><table class="tbl"><thead><tr>
    <th>${t("thCol")}</th><th>n</th><th>${t("thMean")}</th><th>σ</th><th>p50</th><th>p95</th><th>p99</th><th>${t("thMax")}</th><th>${t("thBestFit")}</th><th>${t("thOthers")}</th><th></th></tr></thead><tbody>` +
    L.fits.map((f, i) => {
      const s = f.stats, b = f.best;
      const other = f.cands.slice(1).map((c) => `${t("dist_" + c.type)} ${c.ks.toFixed(3)}`).join(" · ");
      return `<tr><td>${esc(L.names[i])}</td><td>${num(s.n)}</td><td>${s.mean.toFixed(2)}</td><td>${s.sd.toFixed(2)}</td><td>${s.p50.toFixed(2)}</td><td>${s.p95.toFixed(2)}</td><td>${s.p99.toFixed(2)}</td><td>${s.max.toFixed(2)}</td>
        <td>${t("dist_" + b.type)} ${b.mean.toFixed(1)} ± ${b.sd.toFixed(1)} <small>KS ${b.ks.toFixed(3)}</small></td><td><small>${other}</small></td>
        <td><button class="btn ghost xs" type="button" data-usefit="${i}">${t("useFit")}</button></td></tr>`;
    }).join("") + `</tbody></table></div>`;
}

// ---------- 2. 설정 ----------
function renderAllConfig() {
  renderScenarioButtons();
  const c = S.w.camera;
  $("c-mode").value = c.mode; $("c-fps").value = c.fps; $("c-jit").value = c.jitterMs ?? 0;
  $("c-bn").value = c.burstN ?? 100; $("c-bfps").value = c.burstFps ?? 120; $("c-gap").value = c.gapMs ?? 1000;
  $("c-mode").querySelector('[value="log"]').disabled = !(S.log?.arrivals && S.w.logId === S.log.id);
  $("m-frame").value = S.w.frameMB; $("m-base").value = S.w.baseMB; $("m-limit").value = +((S.draft.limitMB || 0) / 1024).toFixed(3);
  $("r-dur").value = +(S.w.durationS / 60).toFixed(3); $("r-seed").value = S.w.seed;
  renderStages();
  renderCamSummary();
  renderPre();
  renderDraftBadge();
}

function renderCamSummary() {
  const c = S.w.camera;
  for (const el of document.querySelectorAll("[data-cam]")) el.hidden = !el.dataset.cam.split(" ").includes(c.mode);
  let s = "";
  if (c.mode === "burst") {
    const per = c.burstN * (1000 / c.burstFps) + +c.gapMs;
    s = t("camBurstSum", { avg: ((c.burstN * 1000) / per).toFixed(1), iv: (1000 / c.burstFps).toFixed(2) });
  } else if (c.mode === "log") s = t("camLogSum");
  else s = t("camSum", { iv: (1000 / c.fps).toFixed(2) });
  $("cam-sum").textContent = s;
  const frames = c.mode === "burst" ? (S.w.durationS * 1000) / ((c.burstN * (1000 / c.burstFps) + +c.gapMs) / c.burstN) : c.mode === "log" && S.log?.arrivals ? (S.w.durationS * 1000) / (S.log.arrivals[S.log.arrivals.length - 1] / (S.log.rows - 1)) : S.w.durationS * c.fps;
  $("run-sum").textContent = t("runSum", { n: num(Math.round(frames)), dur: fmtDur(S.w.durationS * 1000) });
}

function stageRow(s, i) {
  const set = stageSet(S.w, S.draft, s.name);
  const L = S.w.logId && S.log?.id === S.w.logId ? S.log : null;
  const fromOpts = [`<option value="-1">${t("fromCamera")}</option>`, ...S.w.stages.slice(0, i).map((x, j) => `<option value="${j}">${esc(stageLabel(x.name))}</option>`)];
  const distOpts = DIST_TYPES.map((d) => `<option value="${d}">${t("dist_" + d)}</option>`);
  if (L) L.names.forEach((n, j) => { distOpts.push(`<option value="log:${j}:replay">${esc(t("distLogReplay", { col: n }))}</option>`, `<option value="log:${j}:sample">${esc(t("distLogSample", { col: n }))}</option>`); });
  const dv = s.dist.type === "log" ? `log:${s.dist.col}:${s.dist.mode || "replay"}` : s.dist.type;
  const isLog = s.dist.type === "log", noSd = isLog || s.dist.type === "fixed" || s.dist.type === "exp";
  const params = isLog ? `<span class="hint">${L ? t("logParam", { m: L.fits[s.dist.col].stats.mean.toFixed(1), p: L.fits[s.dist.col].stats.p99.toFixed(1) }) : t("logMissing")}</span>`
    : `<input class="num" type="number" min="0" step="any" data-k="mean" value="${s.dist.mean}" aria-label="${t("thMean")} (ms) ${esc(stageLabel(s.name))}">
       <input class="num" type="number" min="0" step="any" data-k="sd" value="${s.dist.sd ?? 0}" ${noSd ? "hidden" : ""} aria-label="σ (ms) ${esc(stageLabel(s.name))}">`;
  const capOff = set.policy === "all" || set.policy === "latest";
  return `<tr data-i="${i}">
    <td class="d"><input class="name" data-k="name" value="${esc(s.name)}" spellcheck="false" aria-label="${t("thStage")} ${i + 1}" title="${esc(stageLabel(s.name))}"><small class="sl">${s.name !== stageLabel(s.name) ? esc(stageLabel(s.name)) : ""}</small></td>
    <td class="d"><select data-k="from" aria-label="${t("thFrom")}">${fromOpts.join("")}</select></td>
    <td class="d"><select data-k="dist" aria-label="${t("thDist")}">${distOpts.join("")}</select></td>
    <td class="d params">${params}</td>
    <td class="d c"><input type="checkbox" data-k="keep" ${s.keep ? "checked" : ""} aria-label="${t("thKeep")}"></td>
    <td class="s"><input class="num sm" type="number" min="1" max="256" step="1" data-k="workers" value="${set.workers}" aria-label="${t("thWorkers")}"></td>
    <td class="s"><input class="num sm" type="number" min="1" step="1" data-k="cap" value="${set.policy === "latest" ? 1 : set.cap}" ${capOff ? "disabled" : ""} aria-label="${t("thCap")}"></td>
    <td class="s"><select data-k="policy" aria-label="${t("thPolicy")}">${POLICIES.map((p) => `<option value="${p}">${policyLabel(p)}</option>`).join("")}</select></td>
    <td><button class="btn ghost xs" type="button" data-del="${i}" ${S.w.stages.length < 2 ? "disabled" : ""} aria-label="${t("delStage")} ${esc(stageLabel(s.name))}">✕</button></td></tr>`;
}
function renderStages() {
  const body = $("stage-body"), ae = document.activeElement;
  const keep = ae && body.contains(ae) ? { i: ae.closest("tr")?.dataset.i, k: ae.dataset.k } : null;
  body.innerHTML = S.w.stages.map(stageRow).join("");
  S.w.stages.forEach((s, i) => {
    const tr = body.children[i];
    tr.querySelector('[data-k="from"]').value = s.from;
    tr.querySelector('[data-k="dist"]').value = s.dist.type === "log" ? `log:${s.dist.col}:${s.dist.mode || "replay"}` : s.dist.type;
    tr.querySelector('[data-k="policy"]').value = stageSet(S.w, S.draft, s.name).policy;
  });
  if (keep) body.querySelector(`tr[data-i="${keep.i}"] [data-k="${keep.k}"]`)?.focus();
}

function onStageInput(e) {
  const el = e.target, tr = el.closest("tr[data-i]");
  if (!tr) return;
  const i = +tr.dataset.i, s = S.w.stages[i], k = el.dataset.k;
  if (!k) return;
  const setOf = () => (S.draft.stages[s.name] = { ...stageSet(S.w, S.draft, s.name) });
  if (k === "name") {
    const v = el.value.trim();
    if (!v || S.w.stages.some((x, j) => j !== i && x.name === v)) { el.setCustomValidity(t("nameDup")); el.reportValidity(); return; }
    el.setCustomValidity("");
    if (e.type !== "change") return;
    S.draft.stages[v] = stageSet(S.w, S.draft, s.name);
    delete S.draft.stages[s.name];
    s.name = v;
    renderStages();
  } else if (k === "from") s.from = +el.value;
  else if (k === "keep") s.keep = el.checked;
  else if (k === "dist") {
    if (el.value.startsWith("log:")) { const [, col, mode] = el.value.split(":"); s.dist = { type: "log", col: +col, mode }; }
    else {
      const prev = s.dist.type === "log" && S.log ? S.log.fits[s.dist.col].stats : s.dist;
      s.dist = { type: el.value, mean: +(+prev.mean).toFixed(3) || 10, sd: el.value === "fixed" || el.value === "exp" ? 0 : +(+(prev.sd ?? 0)).toFixed(3) };
    }
    renderStages();
  } else if (k === "mean" || k === "sd") s.dist[k] = +el.value;
  else if (k === "workers") setOf().workers = Math.max(1, Math.round(+el.value || 1));
  else if (k === "cap") setOf().cap = Math.max(1, Math.round(+el.value || 1));
  else if (k === "policy") { setOf().policy = el.value; renderStages(); }
  markStale();
}
function markStale() {
  S.stale = true;
  $("stale").hidden = false;
  renderPre(); renderDraftBadge(); renderCamSummary(); renderScenarioButtons(); saveState();
}

function renderPre() {
  const ul = $("pre-notes"), err = $("cfg-err");
  const cfg = merge(S.w, S.draft);
  const L = S.w.logId && S.log?.id === S.w.logId ? S.log : null;
  const errs = validate(cfg, L);
  err.textContent = errs.length ? errs.map((x) => `${x.path}: ${t("err_" + x.code)}`).join(" · ") : "";
  $("run").disabled = !!errs.length || S.running;
  if (errs.length) { ul.innerHTML = ""; return; }
  let pre;
  try { pre = precheck(cfg, L); } catch (e) { ul.innerHTML = ""; return; }
  const items = [];
  pre.forEach((p, i) => {
    const nm = stageLabel(cfg.stages[i].name);
    for (const n of p.notes) items.push(`<li class="${n.lv}"><b>${esc(nm)}</b> ${esc(t("pre_" + n.code, { a: n.a?.toFixed?.(1), b: n.b?.toFixed?.(1), rho: n.rho?.toFixed?.(2), n: n.n, cap: n.cap ?? "∞" }))}</li>`);
  });
  ul.innerHTML = items.join("");
}

function renderDraftBadge() {
  const diff = diffSettings(active(), S.draft, S.w.stages.map((s) => s.name));
  const b = $("draft-badge");
  b.className = "badge " + (diff.length ? "warn" : "ok");
  b.textContent = diff.length ? t("draftDiff", { v: S.activeV, n: diff.length }) : t("draftSame", { v: S.activeV });
  $("mode-badge").className = b.className;
  $("mode-badge").textContent = b.textContent;
  $("load-active").disabled = !diff.length;
}

function bindConfig() {
  const cam = (k, f = Number) => (e) => { S.w.camera[k] = f(e.target.value); markStale(); };
  $("c-mode").addEventListener("change", cam("mode", String));
  $("c-fps").addEventListener("input", cam("fps"));
  $("c-jit").addEventListener("input", cam("jitterMs"));
  $("c-bn").addEventListener("input", cam("burstN"));
  $("c-bfps").addEventListener("input", cam("burstFps"));
  $("c-gap").addEventListener("input", cam("gapMs"));
  $("m-frame").addEventListener("input", (e) => { S.w.frameMB = +e.target.value; markStale(); });
  $("m-base").addEventListener("input", (e) => { S.w.baseMB = +e.target.value; markStale(); });
  $("m-limit").addEventListener("input", (e) => { S.draft.limitMB = Math.round(+e.target.value * 1024); markStale(); });
  $("r-dur").addEventListener("input", (e) => { S.w.durationS = +e.target.value * 60; markStale(); });
  $("r-seed").addEventListener("input", (e) => { S.w.seed = Math.max(1, Math.round(+e.target.value)); markStale(); });
  $("stage-body").addEventListener("input", onStageInput);
  $("stage-body").addEventListener("change", onStageInput);
  $("stage-body").addEventListener("click", (e) => {
    const d = e.target.closest("[data-del]");
    if (!d) return;
    const i = +d.dataset.del, gone = S.w.stages[i];
    S.w.stages.splice(i, 1);
    for (const s of S.w.stages) { if (s.from === i) s.from = gone.from; else if (s.from > i) s.from--; }
    renderStages(); markStale();
  });
  $("add-stage").addEventListener("click", () => {
    let n = S.w.stages.length + 1;
    while (S.w.stages.some((s) => s.name === `stage${n}`)) n++;
    S.w.stages.push({ name: `stage${n}`, from: S.w.stages.length - 1, keep: true, dist: { type: "fixed", mean: 10, sd: 0 } });
    renderStages(); markStale();
    $("stage-body").lastElementChild.querySelector("input").focus();
  });
  $("load-active").addEventListener("click", () => { S.draft = clone(active()); renderAllConfig(); markStale(); toast(t("loadedActive", { v: S.activeV })); });
  $("save-workload").addEventListener("click", () => { selectTab("repro"); $("verify").scrollIntoView({ behavior: "smooth" }); setTimeout(() => $("wl-label")?.focus(), 300); });
  $("run").addEventListener("click", () => run());
  $("cancel").addEventListener("click", () => { cancelWork(); setRunning(false); toast(t("canceled")); });
  $("fit-box").addEventListener("click", (e) => {
    const b = e.target.closest("[data-usefit]");
    if (!b) return;
    const col = +b.dataset.usefit, f = S.log.fits[col].best;
    for (const s of S.w.stages) if (s.dist.type === "log" && s.dist.col === col) s.dist = { type: f.type, mean: +f.mean.toFixed(3), sd: +f.sd.toFixed(3) };
    renderStages(); markStale(); toast(t("fitApplied", { col: S.log.names[col] }));
  });
}

// ---------- 실행 ----------
function setRunning(on, label) {
  S.running = on;
  $("progress").hidden = !on;
  $("run").disabled = on;
  if (on) { $("progress-bar").style.width = "0%"; $("progress-text").textContent = label || t("running"); }
  renderPre();
}
async function runOne(w, onProgress) {
  if (w.logId) await ensureLog(w.logId);
  return call({ type: "run", w: dataOf(w), active: active(), draft: S.draft, logId: w.logId || null }, onProgress);
}
const brief = (sum) => ({ pass: sum.pass, fails: sum.fails, keepLoss: sum.keepLoss, dispP99: sum.dispP99, memHitMs: sum.memHitMs, memPeakMB: sum.memPeakMB, fc: sum.fc.kind, grow: sum.grow });
async function addRecord(w, out) {
  const dh = hashOf(S.draft), ah = hashOf(active());
  if (dh === ah) return;
  const rec = { at: Date.now(), wid: widOf(w), wlabel: labelOf(w), draftHash: dh, activeHash: ah, activeV: S.activeV, draft: brief(out.draft.sum), active: brief(out.active.sum) };
  rec.key = await db.put("shadow", rec).catch(db.logError);
  S.records.push(rec);
}
async function run() {
  if (S.running) return;
  const cfg = merge(S.w, S.draft);
  if (validate(cfg, S.log).length) { renderPre(); return; }
  setRunning(true);
  const t0 = performance.now();
  try {
    const out = await runOne(S.w, (p) => { $("progress-bar").style.width = (p * 100).toFixed(0) + "%"; $("progress-text").textContent = `${t("running")} ${(p * 100).toFixed(0)}%`; });
    S.last = { ...out, wid: widOf(S.w), wlabel: labelOf(S.w), at: Date.now(), draftHash: hashOf(S.draft), activeHash: hashOf(active()), activeV: S.activeV, wallMs: performance.now() - t0 };
    S.stale = false; $("stale").hidden = true;
    await addRecord(S.w, out);
    saveLast();
    renderResults(); renderVerify();
  } catch (e) {
    if (e.message !== "E_CANCELED") { $("cfg-err").textContent = errText(e); db.logError(e); }
  } finally { setRunning(false); }
}

// ---------- 3. 결과 ----------
function verdictCards(sum, res, cfg) {
  const cards = [];
  const growNames = sum.grow.map((i) => `${stageLabel(cfg.stages[i].name)} (ρ ${sum.rho[i].toFixed(2)})`);
  cards.push(growNames.length ? { lv: "bad", h: t("vQueueBad"), b: growNames.join(", ") } : { lv: "ok", h: t("vQueueOk"), b: t("vQueueOkB") });
  const lim = res.limitMB;
  const fc = sum.fc;
  if (fc.kind === "nolimit") cards.push({ lv: "info", h: t("vMemNoLimit", { peak: fmtMB(res.memPeakMB) }), b: t("vMemNoLimitB") });
  else if (fc.kind === "sim") cards.push({ lv: "bad", h: t("vMemHit", { lim: fmtMB(lim), at: fmtDur(fc.ms) }), b: t("vMemHitB", { peak: fmtMB(res.memPeakMB) }) });
  else if (fc.kind === "extrap") cards.push({ lv: fc.ms <= S.crit.holdH * 3.6e6 ? "bad" : "warn", h: t("vMemExtrap", { lim: fmtMB(lim), at: fmtDur(fc.ms) }), b: t("vMemExtrapB", { rate: fmtMB(fc.mbPerHour) }) });
  else cards.push({ lv: "ok", h: t("vMemOk", { peak: fmtMB(res.memPeakMB), lim: fmtMB(lim) }), b: t("vMemOkB") });
  if (sum.keepLoss) cards.push({ lv: "bad", h: t("vLossBad", { n: num(sum.keepLoss) }), b: t("vLossBadB") });
  else if (sum.dispDrop) cards.push({ lv: "ok", h: t("vLossDisp", { n: num(sum.dispDrop) }), b: t("vLossDispB") });
  else cards.push({ lv: "ok", h: t("vLossNone"), b: t("vLossNoneB") });
  if (sum.dispP99 === null) cards.push({ lv: "info", h: t("vLatNone"), b: t("vLatNoneB") });
  else cards.push({ lv: sum.dispP99 > S.crit.p99Ms ? "bad" : "ok", h: t("vLat", { p: fmtMs(sum.dispP99) }), b: t("vLatB", { c: fmtMs(S.crit.p99Ms) }) });
  return cards;
}

function renderResults() {
  const L = S.last;
  $("export-row").hidden = !L;
  if (!L) { $("verdict").innerHTML = `<p class="hint">${t("noResult")}</p>`; $("res-table").innerHTML = ""; return; }
  const { cfg, res, sum } = L.draft;
  if (L.wid === widOf(S.w)) L.wlabel = labelOf(S.w);
  $("res-meta").textContent = t("resMeta", { w: L.wlabel, n: num(res.frames), dur: fmtDur(res.endMs), ms: num(Math.round(L.ms)) });
  const cards = verdictCards(sum, res, cfg);
  $("verdict").innerHTML = `<div class="pass ${sum.pass ? "ok" : "bad"}">${sum.pass ? t("passAll") : t("failSome", { list: sum.fails.map((f) => t("crit_" + f)).join(", ") })}</div>` +
    cards.map((c) => `<div class="card ${c.lv}"><b>${esc(c.h)}</b><span>${esc(c.b)}</span></div>`).join("");
  // 단계 표
  const head = ["thStage", "thRho", "thWait", "thAna", "p50", "p95", "p99", "thMax", "thDropped", "thRemain", "thMaxQ", "thNeedQ"];
  const rows = res.stages.map((s, i) => {
    const p = L.pre[i], a = p?.ana;
    let ana = "—";
    if (a && Number.isFinite(a.Wq)) { const err = s.waitMean / a.Wq - 1; ana = `${a.Wq.toFixed(2)} <small>${esc(a.model)}${a.exact ? "" : " " + t("approx")} · ${err >= 0 ? "+" : ""}${(err * 100).toFixed(1)}%</small>`; }
    const need = L.need?.[i];
    const needTxt = need ? (need.grows ? `<span class="bad">${t("needGrow")}</span>` : num(need.maxQ)) : "—";
    const bad = (s.keep && s.dropped) ? "bad" : "";
    return `<tr><td>${esc(stageLabel(s.name))} <small>${s.keep ? t("keepTag") : t("dispTag")} · ${policyLabel(s.policy)} · ×${s.workers}</small></td>
      <td class="${sum.rho[i] >= 1 && (s.policy === "all" || s.keep) ? "bad" : ""}">${sum.rho[i].toFixed(3)}</td><td>${fmtMs(s.waitMean)}</td><td>${ana}</td>
      <td>${fmtMs(s.p50)}</td><td>${fmtMs(s.p95)}</td><td>${fmtMs(s.p99)}</td><td>${fmtMs(s.max)}</td>
      <td class="${bad}">${num(s.dropped)}</td><td>${num(s.remaining)}</td><td>${num(s.maxQ)}</td><td>${needTxt}</td></tr>`;
  });
  $("res-table").innerHTML = `<caption class="sr-only">${t("resTableCap")}</caption><thead><tr>${head.map((h) => `<th scope="col">${h.startsWith("th") ? t(h) : h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody>`;
  // 지연 단계 선택
  const sel = $("lat-stage");
  if (S.latStage >= res.stages.length) S.latStage = 0;
  sel.innerHTML = res.stages.map((s, i) => `<option value="${i}">${esc(stageLabel(s.name))}</option>`).join("");
  sel.value = S.latStage;
  drawCharts();
}

function drawCharts() {
  const L = S.last;
  if (!L) return;
  const { res } = L.draft;
  const ser = res.series;
  if (ser) {
    const qs = res.stages.map((s, i) => ({ name: stageLabel(s.name), color: seriesColor(i), data: ser.q[i] }));
    lineChart($("ch-q"), { series: qs, dt: ser.bucketMs, yFmt: (v) => num(Math.round(v)), xFmt: fmtDur, int: true });
    $("lg-q").innerHTML = qs.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("");
    $("ch-q").setAttribute("aria-label", t("ariaQ", { list: res.stages.map((s) => `${stageLabel(s.name)} ${num(s.maxQ)}`).join(", ") }));
    const memOpt = { ...memSeries([{ name: "mem", color: seriesColor(0), data: ser.mem }], res.limitMB), dt: ser.bucketMs, xFmt: fmtDur };
    if (res.limitHitMs !== null) memOpt.vline = { x: res.limitHitMs, label: t("hitLine", { at: fmtDur(res.limitHitMs) }) };
    lineChart($("ch-mem"), memOpt);
    $("ch-mem").setAttribute("aria-label", t("ariaMem", { peak: fmtMB(res.memPeakMB), lim: res.limitMB ? fmtMB(res.limitMB) : "—" }));
  }
  const s = res.stages[S.latStage], h = s?.hist;
  if (h) {
    histChart($("ch-lat"), { bins: h.bins, hi: h.hi, over: h.over, color: seriesColor(S.latStage), xFmt: fmtMs, marks: [{ v: s.p50, label: "p50 " + fmtMs(s.p50) }, { v: s.p95, label: "p95 " + fmtMs(s.p95) }, { v: s.p99, label: "p99 " + fmtMs(s.p99) }] });
    $("ch-lat").setAttribute("aria-label", t("ariaLat", { s: stageLabel(s.name), p50: fmtMs(s.p50), p95: fmtMs(s.p95), p99: fmtMs(s.p99) }));
  } else { const cv = $("ch-lat"); cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); }
  for (const k of ["q", "mem", "lat"]) if (!$("tb-" + k).hidden) fillChartTable(k);
}

// 메모리 축: 1 GB 를 넘으면 GB 단위로 바꿔 눈금이 깔끔하게
function memSeries(series, limitMB) {
  const big = Math.max(limitMB || 0, ...series.map((s) => Math.max(...s.data))) >= 1024, k = big ? 1 / 1024 : 1;
  const out = { series: series.map((s) => ({ ...s, data: big ? s.data.map((v) => v * k) : s.data })), yFmt: (v) => (big ? `${+v.toFixed(v < 10 ? 1 : 0)} GB` : `${Math.round(v)} MB`) };
  if (limitMB) out.hline = { v: limitMB * k, label: t("limitLine", { v: fmtMB(limitMB) }) };
  return out;
}

function fillChartTable(k) {
  const { res } = S.last.draft, ser = res.series, el = $("tb-" + k);
  if (k === "lat") {
    const s = res.stages[S.latStage], h = s.hist;
    if (!h) { el.innerHTML = ""; return; }
    const w = h.hi / h.bins.length;
    el.innerHTML = `<table class="tbl"><thead><tr><th>${t("thRange")}</th><th>${t("thCount")}</th></tr></thead><tbody>${[...h.bins].map((c, i) => `<tr><td>${fmtMs(i * w)} – ${fmtMs((i + 1) * w)}</td><td>${num(c)}</td></tr>`).join("")}${h.over ? `<tr><td>&gt; ${fmtMs(h.hi)}</td><td>${num(h.over)}</td></tr>` : ""}</tbody></table>`;
    return;
  }
  if (!ser) return;
  const n = ser.mem.length, step = Math.ceil(n / 24), idx = [];
  for (let i = step - 1; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  const head = k === "q" ? res.stages.map((s) => esc(stageLabel(s.name))) : [t("chMem")];
  el.innerHTML = `<table class="tbl"><thead><tr><th>${t("thTime")}</th>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${idx.map((i) => {
    const cells = k === "q" ? res.stages.map((_, j) => num(Math.round(ser.q[j][i]))) : [fmtMB(ser.mem[i])];
    return `<tr><td>${fmtDur((i + 1) * ser.bucketMs)}</td>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
  }).join("")}</tbody></table>`;
}

// ---------- 4. 현장 검증 ----------
function selectTab(k) {
  S.tab = k;
  for (const x of ["repro", "compare", "shadow", "switch"]) {
    const tab = $("vt-" + x), on = x === k;
    tab.setAttribute("aria-selected", on); tab.tabIndex = on ? 0 : -1;
    $("vp-" + x).hidden = !on;
  }
  renderVerify();
  saveState();
}
function renderVerify() {
  renderDraftBadge();
  if (S.tab === "repro") renderRepro();
  else if (S.tab === "compare") renderCompare();
  else if (S.tab === "shadow") renderShadow();
  else renderSwitch();
}
const verdictCell = (b) => (b ? `<span class="${b.pass ? "ok" : "bad"}">${b.pass ? t("pass") : t("fail")}</span> <small>${b.pass ? "" : b.fails.map((f) => t("crit_" + f)).join(", ")}</small>` : "—");

function allWorkloads() { return [...SCENARIOS.map((_, i) => builtin(i)), ...S.saved]; }
function renderRepro() {
  const el = $("vp-repro");
  const list = allWorkloads();
  el.innerHTML = `<p class="hint">${t("reproHint")}</p>
    <div class="row"><button class="btn" type="button" id="repro-run">${t("reproRun", { v: S.activeV })}</button><span id="repro-prog" class="hint" aria-live="polite"></span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t("thWorkload")}</th><th>${t("thData")}</th><th>${t("thActiveV", { v: S.activeV })}</th><th>${t("thDraft")}</th><th></th></tr></thead><tbody>` +
    list.map((w) => {
      const r = S.repro[widOf(w)], ok = r && r.activeV === S.activeV && r.draftHash === hashOf(S.draft);
      return `<tr><td>${esc(labelOf(w))}${w.builtin ? ` <small>${t("builtinTag")}</small>` : ""}</td><td><small>${esc(dataSummary(w))}</small></td>
        <td>${ok ? verdictCell(r.active) : "—"}</td><td>${ok ? verdictCell(r.draft) : "—"}</td>
        <td><button class="btn ghost xs" type="button" data-open="${esc(w.id)}">${t("open")}</button>${w.builtin ? "" : ` <button class="btn ghost xs danger" type="button" data-delw="${esc(w.id)}">${t("delete")}</button>`}</td></tr>`;
    }).join("") + `</tbody></table></div>
    <form class="row" id="wl-form"><label class="field inline"><span>${t("wlLabel")}</span><input id="wl-label" required maxlength="80" value="${esc(S.w.builtin ? "" : S.w.label || "")}" placeholder="${esc(t("wlPh"))}"></label>
      <button class="btn ghost sm" type="submit">${t("saveWorkload")}</button></form>`;
}
function dataSummary(w) {
  const c = w.camera;
  const cam = c.mode === "burst" ? t("sumBurst", { n: c.burstN, fps: c.burstFps, gap: c.gapMs }) : c.mode === "log" ? t("camLog") : `${c.fps} fps${c.mode === "poisson" ? " " + t("camPoisson") : ""}`;
  const path = w.stages.map((s) => `${s.from === -1 ? t("fromCamera") : stageLabel(w.stages[s.from].name)}→${stageLabel(s.name)}`).join(", ");
  return `${cam} · ${fmtDur(w.durationS * 1000)} · ${path}${w.logId ? " · " + t("logTag") : ""}`;
}
async function reproRunAll() {
  const list = allWorkloads(), prog = $("repro-prog");
  setRunning(true, t("reproRunning"));
  try {
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      prog.textContent = `${i + 1} / ${list.length} · ${labelOf(w)}`;
      try {
        const out = await runOne(w, (p) => { $("progress-bar").style.width = (((i + p) / list.length) * 100).toFixed(0) + "%"; });
        S.repro[widOf(w)] = { at: Date.now(), activeV: S.activeV, draftHash: hashOf(S.draft), active: brief(out.active.sum), draft: brief(out.draft.sum) };
        await addRecord(w, out);
      } catch (e) { if (e.message === "E_CANCELED") throw e; S.repro[widOf(w)] = null; toast(`${labelOf(w)}: ${errText(e)}`); }
    }
    prog.textContent = t("reproDone", { n: list.length });
  } catch (e) { prog.textContent = t("canceled"); }
  finally { setRunning(false); renderVerify(); }
}

function renderCompare() {
  const el = $("vp-compare"), L = S.last;
  if (!L) { el.innerHTML = `<p class="hint">${t("noResult")}</p>`; return; }
  if (L.draftHash === L.activeHash) { el.innerHTML = `<p class="hint">${t("cmpSame", { v: L.activeV })}</p>`; return; }
  const names = L.draft.cfg.stages.map((s) => s.name);
  const A = S.versions.find((v) => v.v === L.activeV)?.settings || active();
  const diff = diffSettings(A, merge0(L.draft.cfg), names);
  const dRows = diff.map((d) => `<tr><td>${d.path === "limitMB" ? t("limitGB") : `${esc(stageLabel(d.stage))} · ${t("th" + { workers: "Workers", cap: "Cap", policy: "Policy" }[d.key])}`}</td>
    <td>${fmtSet(d, d.a)}</td><td class="chg">${fmtSet(d, d.b)}</td></tr>`).join("");
  const a = L.active, b = L.draft;
  const row = (label, fa, fb, same) => `<tr><td>${label}</td><td>${fa}</td><td class="${same ? "" : "chg"}">${fb}</td></tr>`;
  const sumRows = [
    row(t("crit_pass"), verdictCell(brief(a.sum)), verdictCell(brief(b.sum)), a.sum.pass === b.sum.pass),
    row(t("cmpMemPeak"), fmtMB(a.res.memPeakMB), fmtMB(b.res.memPeakMB), Math.abs(a.res.memPeakMB - b.res.memPeakMB) < 1),
    row(t("cmpMemHit"), fcText(a.sum.fc), fcText(b.sum.fc), fcText(a.sum.fc) === fcText(b.sum.fc)),
    row(t("cmpKeepLoss"), num(a.sum.keepLoss), num(b.sum.keepLoss), a.sum.keepLoss === b.sum.keepLoss),
    row(t("cmpDispP99"), fmtMs(a.sum.dispP99), fmtMs(b.sum.dispP99), close(a.sum.dispP99, b.sum.dispP99)),
  ];
  const stRows = b.res.stages.map((sb, i) => {
    const sa = a.res.stages[i];
    return [
      row(`${esc(stageLabel(sb.name))} · ${t("thDropped")}`, num(sa.dropped), num(sb.dropped), sa.dropped === sb.dropped),
      row(`${esc(stageLabel(sb.name))} · p99`, fmtMs(sa.p99), fmtMs(sb.p99), close(sa.p99, sb.p99)),
      row(`${esc(stageLabel(sb.name))} · ${t("thMaxQ")}`, num(sa.maxQ), num(sb.maxQ), sa.maxQ === sb.maxQ),
    ].join("");
  }).join("");
  el.innerHTML = `<p class="hint">${t("cmpHint", { w: esc(L.wlabel) })}</p>
    <div class="cmp-grid"><div><h3>${t("cmpSettings")}</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>${t("thActiveV", { v: L.activeV })}</th><th>${t("thDraft")}</th></tr></thead><tbody>${dRows}</tbody></table></div></div>
    <div><h3>${t("cmpResults")} <small>${t("cmpOnlyChg")}</small></h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>${t("thActiveV", { v: L.activeV })}</th><th>${t("thDraft")}</th></tr></thead><tbody>${sumRows.join("")}${stRows}</tbody></table></div></div></div>
    <figure class="chart"><figcaption><b>${t("cmpMemChart")}</b> <span class="legend inline"><span><i style="background:var(--mid)"></i>${t("thActiveV", { v: L.activeV })}</span><span><i style="background:var(--s1)"></i>${t("thDraft")}</span></span></figcaption><canvas id="ch-cmp" role="img" aria-label="${esc(t("ariaCmp", { a: fmtMB(a.res.memPeakMB), b: fmtMB(b.res.memPeakMB) }))}"></canvas></figure>
    <div class="row"><button class="btn ghost sm" type="button" id="discard-draft">${t("discardDraft")}</button></div>`;
  if (a.res.series && b.res.series) {
    const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const opt = { ...memSeries([{ name: "A", color: css("--mid"), data: a.res.series.mem, dash: [6, 4] }, { name: "B", color: seriesColor(0), data: b.res.series.mem }], b.res.limitMB), dt: b.res.series.bucketMs, xFmt: fmtDur };
    lineChart($("ch-cmp"), opt, 200);
  }
}
const merge0 = (cfg) => ({ limitMB: cfg.limitMB, stages: Object.fromEntries(cfg.stages.map((s) => [s.name, { workers: s.workers, cap: s.cap, policy: s.policy }])) });
const close = (x, y) => (x === null && y === null) || (x !== null && y !== null && Math.abs(x - y) <= Math.max(1, 0.05 * Math.abs(x)));
const fmtSet = (d, v) => (v === undefined ? "—" : d.path === "limitMB" ? fmtMB(v) : d.key === "policy" ? policyLabel(v) : num(v));
const fcText = (fc) => (fc.kind === "sim" ? fmtDur(fc.ms) : fc.kind === "extrap" ? "≈ " + fmtDur(fc.ms) : fc.kind === "nolimit" ? t("noLimit") : t("notReached"));

function renderShadow() {
  const el = $("vp-shadow");
  const dh = hashOf(S.draft);
  const recs = S.records.slice().reverse().filter((r) => !S.onlyDiff || r.draft.pass !== r.active.pass);
  el.innerHTML = `<p class="hint">${t("shadowHint")}</p>
    <form class="crit" id="crit-form"><b>${t("critTitle")}</b>
      <span class="chip">${t("critKeep")}</span>
      <label class="field inline"><span>${t("critHold")}</span><input type="number" min="0.1" step="any" id="cr-hold" value="${S.crit.holdH}"></label>
      <label class="field inline"><span>${t("critP99")}</span><input type="number" min="1" step="any" id="cr-p99" value="${S.crit.p99Ms}"></label>
      <label class="field inline"><span>${t("critCases")}</span><input type="number" min="1" step="1" id="cr-cases" value="${S.crit.minCases}"></label></form>
    <div class="row"><label class="field chk"><input type="checkbox" id="only-diff" ${S.onlyDiff ? "checked" : ""}> <span>${t("onlyDiff")}</span></label><span class="grow"></span>
      <button class="btn ghost sm danger" type="button" id="clear-shadow" ${S.records.length ? "" : "disabled"}>${t("clearShadow")}</button></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t("thWhen")}</th><th>${t("thWorkload")}</th><th>${t("thActiveCol")}</th><th>${t("thDraftCol")}</th><th>${t("thDiff")}</th></tr></thead><tbody>` +
    (recs.length ? recs.slice(0, 200).map((r) => `<tr class="${r.draftHash === dh ? "" : "old"}"><td>${new Date(r.at).toLocaleString(getLang())}</td><td>${esc(r.wlabel)}${r.draftHash === dh ? "" : ` <small>${t("oldDraft")}</small>`}</td>
      <td>v${r.activeV} ${verdictCell(r.active)}</td><td>${verdictCell(r.draft)}</td><td>${r.draft.pass !== r.active.pass ? `<b class="chg">${t("differs")}</b>` : ""}</td></tr>`).join("")
      : `<tr><td colspan="5" class="hint">${t("noShadow")}</td></tr>`) + `</tbody></table></div>`;
}

function renderSwitch() {
  const el = $("vp-switch");
  const st = switchState(S.records, hashOf(S.draft), hashOf(active()), S.crit);
  const why = st.ok ? t("swOk", { n: st.n }) : t("sw_" + st.why, { n: st.n, need: st.need });
  const vs = S.versions.slice().reverse();
  el.innerHTML = `<div class="sw-state ${st.ok ? "ok" : ""}"><b>${esc(why)}</b>
      <div class="row"><label class="field inline"><span>${t("swNote")}</span><input id="sw-note" maxlength="120" placeholder="${esc(t("swNotePh"))}"></label>
      <button class="btn" type="button" id="do-switch" ${st.ok ? "" : "disabled"}>${t("doSwitch", { v: Math.max(...S.versions.map((v) => v.v)) + 1 })}</button></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t("thVersion")}</th><th>${t("thWhen")}</th><th>${t("thKind")}</th><th>${t("thSettings")}</th><th></th></tr></thead><tbody>` +
    vs.map((v) => `<tr class="${v.v === S.activeV ? "cur" : ""}"><td>v${v.v}${v.v === S.activeV ? ` <span class="badge ok">${t("inUse")}</span>` : ""}</td><td>${new Date(v.at).toLocaleString(getLang())}</td>
      <td>${t("kind_" + v.kind, { from: v.fromV })}${v.note ? ` <small>${esc(v.note)}</small>` : ""}</td><td><small>${esc(setSummary(v.settings))}</small></td>
      <td>${v.v === S.activeV ? "" : `<button class="btn ghost xs" type="button" data-rollback="${v.v}">${t("rollback")}</button>`}</td></tr>`).join("") +
    `</tbody></table></div>
    <div class="row"><button class="btn ghost sm" type="button" id="exp-settings">${t("expSettings", { v: S.activeV })}</button>
      <label class="btn ghost sm file-like"><span>${t("impSettings")}</span><input type="file" id="imp-settings" accept=".json,application/json" class="sr-only"></label>
      <span class="hint">${t("impHint")}</span></div>`;
}
const setSummary = (s) => `${t("limitShort")} ${fmtMB(s.limitMB)} · ` + Object.entries(s.stages).map(([n, x]) => `${stageLabel(n)} ${policyLabel(x.policy)}${x.policy === "all" || x.policy === "latest" ? "" : " " + x.cap}${x.workers > 1 ? " ×" + x.workers : ""}`).join(" · ");

async function addVersion(settings, kind, fromV, note) {
  const v = Math.max(...S.versions.map((x) => x.v)) + 1;
  const rec = { v, at: Date.now(), settings: clone(settings), kind, fromV, note: note || "" };
  await db.put("history", rec);
  S.versions.push(rec);
  S.activeV = v;
  saveState();
  return v;
}

function bindVerify() {
  const tabs = ["repro", "compare", "shadow", "switch"];
  for (const k of tabs) $("vt-" + k).addEventListener("click", () => selectTab(k));
  document.querySelector(".vtabs").addEventListener("keydown", (e) => {
    const i = tabs.indexOf(S.tab);
    const j = e.key === "ArrowRight" ? (i + 1) % 4 : e.key === "ArrowLeft" ? (i + 3) % 4 : e.key === "Home" ? 0 : e.key === "End" ? 3 : -1;
    if (j < 0) return;
    e.preventDefault(); selectTab(tabs[j]); $("vt-" + tabs[j]).focus();
  });
  const vf = $("verify");
  vf.addEventListener("click", async (e) => {
    const x = e.target.closest("button");
    if (!x) return;
    if (x.id === "repro-run") reproRunAll();
    else if (x.dataset.open) {
      const w = allWorkloads().find((w) => w.id === x.dataset.open);
      if (!w) return;
      S.log = w.logId ? await db.get("logs", w.logId) : null;
      if (w.logId && !S.log) { toast(errText(new Error("E_LOG_MISSING"))); return; }
      openWorkload(w); renderLogInfo(); await run();
      $("results").scrollIntoView({ behavior: "smooth" });
    } else if (x.dataset.delw) {
      await db.del("workloads", x.dataset.delw);
      S.saved = S.saved.filter((w) => w.id !== x.dataset.delw);
      renderVerify();
    } else if (x.id === "discard-draft") { S.draft = clone(active()); renderAllConfig(); markStale(); renderVerify(); }
    else if (x.id === "clear-shadow") { await db.clear("shadow"); S.records = []; renderVerify(); }
    else if (x.id === "do-switch") {
      const v = await addVersion(S.draft, "switch", S.activeV, $("sw-note").value.trim());
      toast(t("switched", { v })); renderDraftBadge(); renderVerify();
    } else if (x.dataset.rollback) {
      const from = +x.dataset.rollback, src = S.versions.find((v) => v.v === from);
      const v = await addVersion(src.settings, "rollback", from, "");
      toast(t("rolledBack", { v, from })); renderDraftBadge(); renderVerify();
    } else if (x.id === "exp-settings") {
      download(`frame-backlog-settings-v${S.activeV}.json`, JSON.stringify({ app: "frame-backlog-sim", kind: "settings", v: S.activeV, exported: new Date().toISOString(), settings: active() }, null, 2), "application/json");
    }
  });
  vf.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (e.target.id === "wl-form") {
      const label = $("wl-label").value.trim();
      if (!label) return;
      const w = { ...clone(S.w), id: "u-" + Date.now().toString(36), builtin: false, label };
      w.origin = widOf(w);
      await db.put("workloads", w);
      S.saved.push(w); S.w = clone(w);
      saveState(); renderScenarioButtons(); renderVerify(); toast(t("savedWorkload", { label }));
    }
  });
  vf.addEventListener("change", async (e) => {
    const id = e.target.id;
    if (id === "only-diff") { S.onlyDiff = e.target.checked; renderShadow(); saveState(); }
    else if (id === "cr-hold" || id === "cr-p99" || id === "cr-cases") {
      S.crit = { holdH: Math.max(0.1, +$("cr-hold").value || CRITERIA.holdH), p99Ms: Math.max(1, +$("cr-p99").value || CRITERIA.p99Ms), minCases: Math.max(1, Math.round(+$("cr-cases").value || CRITERIA.minCases)) };
      saveState(); toast(t("critSaved"));
    } else if (id === "imp-settings") {
      try {
        const j = JSON.parse(await e.target.files[0].text());
        const s = j?.settings;
        if (j?.app !== "frame-backlog-sim" || !s || typeof s.stages !== "object") throw new Error("E_SETTINGS");
        for (const x of Object.values(s.stages)) if (!POLICIES.includes(x.policy) || !(x.workers >= 1) || !(x.cap >= 1)) throw new Error("E_SETTINGS");
        S.draft = { limitMB: +s.limitMB || 0, stages: clone(s.stages) };
        renderAllConfig(); markStale(); renderVerify(); toast(t("importedDraft"));
      } catch (err) { toast(errText(err)); }
      e.target.value = "";
    }
  });
}

// ---------- 내보내기 ----------
function stageTableData() {
  const { res, sum } = S.last.draft;
  const head = ["stage", "keep", "policy", "workers", "rho", "wait_mean_ms", "p50_ms", "p95_ms", "p99_ms", "max_ms", "offered", "served", "dropped", "remaining", "max_queue", "need_queue"];
  const rows = res.stages.map((s, i) => [s.name, s.keep ? 1 : 0, s.policy, s.workers, sum.rho[i].toFixed(4), s.waitMean.toFixed(3), s.p50?.toFixed(3), s.p95?.toFixed(3), s.p99?.toFixed(3), s.max?.toFixed(3), s.offered, s.served, s.dropped, s.remaining, s.maxQ, S.last.need?.[i]?.grows ? "grows" : S.last.need?.[i]?.maxQ]);
  return { head, rows };
}
function bindExport() {
  $("exp-json").addEventListener("click", () => {
    const L = S.last;
    const strip = (r) => r && { cfg: r.cfg, sum: r.sum, res: { ...r.res, series: r.res.series && { bucketMs: r.res.series.bucketMs, mem: Array.from(r.res.series.mem), q: r.res.series.q.map((a) => Array.from(a)) }, stages: r.res.stages.map((s) => ({ ...s, hist: s.hist && { ...s.hist, bins: Array.from(s.hist.bins) } })) } };
    download("frame-backlog-result.json", JSON.stringify({ app: "frame-backlog-sim", version: VERSION, exported: new Date().toISOString(), workload: { label: L.wlabel, ...dataOf(S.w) }, activeV: L.activeV, draft: strip(L.draft), active: L.draftHash === L.activeHash ? "same as draft" : strip(L.active), need: L.need, criteria: S.crit }, null, 1), "application/json");
  });
  $("exp-csv").addEventListener("click", () => {
    const { head, rows } = stageTableData(), ser = S.last.draft.res.series;
    const series = ser && { head: ["time_ms", ...S.last.draft.res.stages.map((s) => "queue_" + s.name), "memory_mb"], rows: [...ser.mem].map((m, i) => [((i + 1) * ser.bucketMs).toFixed(1), ...ser.q.map((q) => q[i]), m.toFixed(1)]) };
    download("frame-backlog-result.csv", toCSV(head, rows, series), "text/csv");
  });
  $("exp-html").addEventListener("click", () => {
    const L = S.last, { res } = L.draft;
    const cards = verdictCards(L.draft.sum, res, L.draft.cfg);
    const images = [["chQueue", "ch-q"], ["chMem", "ch-mem"], ["chLat", "ch-lat"]].map(([k, id]) => ({ title: t(k), src: $(id).toDataURL("image/png") }));
    const html = toHTML({
      lang: getLang(), title: t("appName") + " — " + L.wlabel,
      meta: `${new Date(L.at).toLocaleString(getLang())} · ${t("resMeta", { w: L.wlabel, n: num(res.frames), dur: fmtDur(res.endMs), ms: num(Math.round(L.ms)) })} · v${VERSION}`,
      sections: [
        { title: t("verdictTitle"), html: `<ul>${cards.map((c) => `<li class="${c.lv === "bad" ? "bad" : c.lv === "ok" ? "ok" : ""}">${esc(c.h)} — ${esc(c.b)}</li>`).join("")}</ul>` },
        { title: t("resultsTitle"), html: $("res-table").outerHTML },
        { title: t("configTitle"), html: `<pre>${esc(JSON.stringify(L.draft.cfg, null, 1))}</pre>` },
      ],
      images,
    });
    download("frame-backlog-report.html", html, "text/html");
  });
}

// ---------- 도움말 · 설정 · 첫 실행 ----------
function bindDialogs() {
  $("open-help").addEventListener("click", () => { $("help-body").innerHTML = t("helpHtml"); $("help").showModal(); });
  $("help").addEventListener("click", async (e) => {
    if (e.target.id !== "acc-run") return;
    const out = $("acc-out");
    e.target.disabled = true;
    out.innerHTML = `<p class="hint">${t("accRunning")}</p>`;
    try {
      const r = await call({ type: "accuracy", reps: 10, frames: 100000 }, (p) => { out.innerHTML = `<p class="hint">${t("accRunning")} ${(p * 100).toFixed(0)}%</p>`; });
      out.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t("thModel")}</th><th>ρ</th><th>${t("thAnaWq")}</th><th>${t("thSimWq")}</th><th>${t("thErr10")}</th><th>${t("thCi")}</th><th>${t("thErr1")}</th><th>${t("thSdRun")}</th></tr></thead><tbody>` +
        r.rows.map((x) => { const ci = (1.96 * x.sdRun) / Math.sqrt(x.reps), ok = Math.abs(x.err) <= ci + 0.002;
          return `<tr><td>${x.label}</td><td>${x.rho}</td><td>${x.Wq.toFixed(3)}</td><td>${x.sim.toFixed(3)}</td><td>${(x.err * 100).toFixed(2)}%</td><td class="${ok ? "ok" : "bad"}">±${(ci * 100).toFixed(2)}% ${ok ? "✓" : "✗"}</td><td>${(x.first * 100).toFixed(2)}%</td><td>±${(x.sdRun * 100).toFixed(1)}%</td></tr>`; }).join("") + `</tbody></table></div><p class="hint">${t("accNote")}</p>`;
    } catch (err) { out.innerHTML = `<p class="msg err">${esc(errText(err))}</p>`; }
    e.target.disabled = false;
  });
  $("open-settings").addEventListener("click", () => { $("settings-msg").textContent = ""; $("settings").showModal(); });
  $("backup-export").addEventListener("click", async () => download("frame-backlog-backup.json", JSON.stringify(await db.exportBackup()), "application/json"));
  $("backup-import").addEventListener("change", async (e) => {
    try { await db.importBackup(JSON.parse(await e.target.files[0].text())); $("settings-msg").textContent = t("backupDone"); setTimeout(() => location.reload(), 800); }
    catch (err) { $("settings-msg").textContent = errText(err); }
    e.target.value = "";
  });
  $("errors-export").addEventListener("click", async () => download("frame-backlog-errors.json", JSON.stringify(await db.all("errors"), null, 1), "application/json"));
  $("reset-all").addEventListener("click", async () => {
    if (!confirm(t("resetConfirm"))) return;
    await db.clearAll(); location.reload();
  });
}

function applyTheme() {
  const r = document.documentElement;
  if (S.theme === "auto") r.removeAttribute("data-theme"); else r.dataset.theme = S.theme;
  $("theme").title = t("theme") + ": " + t("theme_" + S.theme);
  $("theme").setAttribute("aria-label", $("theme").title);
}
function relabel() {
  applyI18n(document);
  document.title = t("appName");
  $("version").textContent = "v" + VERSION;
  applyTheme();
  renderAllConfig(); renderLogInfo(); renderResults(); renderVerify();
}

// ---------- 시작 ----------
async function init() {
  window.addEventListener("error", (e) => { db.logError(e.error || e.message); });
  window.addEventListener("unhandledrejection", (e) => { db.logError(e.reason); toast(errText(e.reason)); });
  const st = await db.get("kv", "state").catch(() => null);
  let saved = null;
  try { saved = localStorage.getItem("fbs-lang"); } catch { /* 사생활 보호 창 */ }
  setLang(saved || (navigator.language || "ko").slice(0, 2));
  $("lang").value = getLang();
  S.versions = ((await db.all("history").catch(() => [])) || []).sort((a, b) => a.v - b.v);
  if (!S.versions.length) {
    S.versions = [{ v: 1, at: Date.now(), settings: clone(FIRST_SETTINGS), kind: "first", fromV: null, note: "" }];
    await db.put("history", S.versions[0]).catch(db.logError);
  }
  S.saved = (await db.all("workloads").catch(() => [])) || [];
  S.records = (await db.all("shadow").catch(() => [])) || [];
  if (st?.w) Object.assign(S, { w: st.w, draft: st.draft, activeV: st.activeV, crit: { ...CRITERIA, ...st.crit }, theme: st.theme || "auto", latStage: st.latStage || 0, tab: st.tab || "repro", readOpts: st.readOpts || {}, onlyDiff: !!st.onlyDiff });
  else { S.w = builtin(0); S.draft = clone(active()); }
  if (!S.versions.some((v) => v.v === S.activeV)) S.activeV = S.versions[S.versions.length - 1].v;
  if (S.w.logId) { S.log = await db.get("logs", S.w.logId).catch(() => null); if (!S.log) { S.w = builtin(0); toast(t("err_E_LOG_MISSING")); } }
  fillReadOpts();
  const last = await db.get("kv", "last").catch(() => null);
  if (last && last.wid === widOf(S.w) && last.draftHash === hashOf(S.draft)) S.last = last;

  bindConfig(); bindVerify(); bindExport(); bindDialogs();
  $("scenario-btns").addEventListener("click", (e) => { const b = e.target.closest("[data-sc]"); if (b) openBuiltin(+b.dataset.sc); });
  $("file").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ""; });
  $("open-sample-log").addEventListener("click", () => openFile(null, sampleLog()));
  $("download-sample").addEventListener("click", () => download("sample-timing-log.csv", sampleLog(), "text/csv"));
  $("reread").addEventListener("click", () => { if (lastFile) openFile(lastFile.file, lastFile.text); else toast(t("rereadNone")); });
  $("lat-stage").addEventListener("change", (e) => { S.latStage = +e.target.value; drawCharts(); saveState(); });
  for (const b of document.querySelectorAll("[data-table]")) b.addEventListener("click", () => {
    const k = b.dataset.table, el = $("tb-" + k), on = el.hidden;
    el.hidden = !on; b.setAttribute("aria-pressed", on); b.textContent = t(on ? "asChart" : "asTable");
    if (on && S.last) fillChartTable(k);
  });
  $("lang").addEventListener("change", (e) => { setLang(e.target.value); try { localStorage.setItem("fbs-lang", getLang()); } catch { /* 저장 못 해도 동작 */ } relabel(); });
  $("theme").addEventListener("click", () => { S.theme = { auto: "light", light: "dark", dark: "auto" }[S.theme]; applyTheme(); drawCharts(); if (S.tab === "compare") renderCompare(); saveState(); });
  document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); } });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { drawCharts(); });
  let rz = 0;
  new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { drawCharts(); if (S.tab === "compare") renderCompare(); }, 120); }).observe($("results"));
  // 끌어다 놓기
  document.body.dataset.drop = t("dropHere");
  addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("dragging"); });
  addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("dragging"); });
  addEventListener("drop", (e) => { e.preventDefault(); document.body.classList.remove("dragging"); const f = e.dataTransfer.files[0]; if (f) openFile(f); });

  relabel();
  selectTab(S.tab);
  if (!S.last) run();
  if (!(await db.get("kv", "onboarded").catch(() => true))) { $("onboard").showModal(); db.put("kv", true, "onboarded"); }
  if (!(await db.persistent())) toast(t("noIdb"), 6000);
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        nw?.addEventListener("statechange", () => { if (nw.state === "installed" && navigator.serviceWorker.controller) toast(t("updateReady"), 8000); });
      });
    }).catch(db.logError);
  }
}
init();
