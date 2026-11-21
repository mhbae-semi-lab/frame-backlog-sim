// 작업 데이터(workload)와 장비 설정(settings)을 나눈다.
// - 작업 데이터: 카메라 도착, 단계 연결, 단계별 처리 시간(분포 또는 로그), 프레임 크기, 기본 메모리, 기간, 시드. 재현 세트의 한 항목.
// - 장비 설정: 단계 이름별 작업자 수 · 큐 크기 · 넘칠 때 정책, 메모리 한도. 버전으로 남기고 전환 · 롤백한다.
import { simulate, unboundedTwin, memoryForecast, loads, arrivalStats, distStats } from "./engine.js";
import { expectedWait } from "./analytic.js";

export const STAGE_DEFAULT = { workers: 1, cap: 8, policy: "all" };
export const CRITERIA = { holdH: 24, p99Ms: 250, minCases: 3 };
const DROPPING = ["latest", "dropOld", "dropNew"];

export function stageSet(w, set, name) {
  const s = w.stages.find((x) => x.name === name);
  return { ...STAGE_DEFAULT, ...(s?.def || {}), ...(set?.stages?.[name] || {}) };
}

export function merge(w, set) {
  return {
    seed: w.seed, durationS: w.durationS, frames: w.frames, camera: w.camera, frameMB: w.frameMB, baseMB: w.baseMB,
    limitMB: set?.limitMB ?? w.limitMB ?? 0,
    stages: w.stages.map((s) => ({ name: s.name, from: s.from, keep: !!s.keep, dist: s.dist, ...stageSet(w, set, s.name) })),
  };
}

// 작업 데이터에 지금 들어 있는 단계 설정을 장비 설정으로 뽑는다
export function settingsOf(w, base) {
  const out = { limitMB: base?.limitMB ?? w.limitMB ?? 0, stages: { ...(base?.stages || {}) } };
  for (const s of w.stages) out.stages[s.name] = stageSet(w, base, s.name);
  return out;
}

export function hashOf(o) { // 설정 비교용 짧은 해시 (키 순서 고정)
  const s = JSON.stringify(o, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

// 두 설정에서 바뀐 항목 (경로 목록)
export function diffSettings(a, b, names) {
  const out = [];
  if ((a?.limitMB ?? 0) !== (b?.limitMB ?? 0)) out.push({ path: "limitMB", a: a?.limitMB, b: b?.limitMB });
  for (const n of names) for (const k of ["workers", "cap", "policy"]) {
    const x = a?.stages?.[n]?.[k], y = b?.stages?.[n]?.[k];
    if (x !== y && !(k === "cap" && ["all", "latest"].includes(a?.stages?.[n]?.policy) && ["all", "latest"].includes(b?.stages?.[n]?.policy)))
      out.push({ path: `${n}.${k}`, stage: n, key: k, a: x, b: y });
  }
  return out;
}

// ---------- 실행 전 점검 (분포만으로) ----------
// 단계마다 들어오는 평균 간격을 앞 단계 처리 능력으로 깎아 내려가며 계산한다
export function precheck(cfg, log) {
  const cam = arrivalStats(cfg.camera, log);
  const out = [];
  const lam = [];
  cfg.stages.forEach((s, i) => {
    const ds = distStats(s.dist, (cfg.seed >>> 0) || 1, i + 1, log);
    const inLam = s.from === -1 ? 1 / cam.mean : lam[s.from];
    const cap = s.workers / ds.mean;
    lam[i] = Math.min(inLam, cap);
    const rho = (inLam * ds.mean) / s.workers, I = 1 / inLam;
    const notes = [];
    if (rho >= 1 && s.policy === "all") notes.push({ lv: "err", code: "P_GROW", a: ds.mean / s.workers, b: I, rho });
    else if (rho >= 1) notes.push({ lv: s.keep ? "err" : "info", code: s.keep ? "P_LOSS_KEEP" : "P_DROP_OK", rho, a: ds.mean / s.workers, b: I });
    else if (ds.p99 / s.workers > I) notes.push({ lv: "warn", code: "P_P99", a: ds.p99, b: I * s.workers });
    if (s.keep && DROPPING.includes(s.policy)) notes.push({ lv: "warn", code: "P_KEEP_DROP" });
    if (s.from === -1 && s.policy === "block") notes.push({ lv: "info", code: "P_CAM_BLOCK" });
    if (s.from === -1 && cfg.camera.mode === "burst") {
      const ib = 1000 / cfg.camera.burstFps, grow = 1 - (ib * s.workers) / ds.mean;
      if (grow > 0) notes.push({ lv: "info", code: "P_BURST", n: Math.ceil(Math.round(cfg.camera.burstN) * grow), cap: s.policy === "all" ? null : s.policy === "latest" ? 1 : s.cap });
    }
    let ana = null;
    if (s.from === -1 && s.policy === "all") ana = expectedWait({ mean: cam.mean, ca2: cam.cv2, s: ds.mean, cs2: ds.cv2, c: s.workers });
    out.push({ rho, interval: I, svc: ds, notes, ana });
  });
  return out;
}

// ---------- 실행 결과 요약 · 판정 ----------
export function summarize(cfg, res, crit = CRITERIA) {
  const rho = loads(cfg, res).map((r, i) => ({ ...r, rho: Math.max(r.rho, r.unbounded && res.stages[i].util >= 0.99 ? 1 : 0) }));
  const fc = memoryForecast(res, rho);
  let keepLoss = 0, dispP99 = null, dispDrop = 0;
  const grow = [];
  res.stages.forEach((s, i) => {
    if (s.keep) keepLoss += s.dropped; else { dispDrop += s.dropped; if (s.p99 !== null) dispP99 = Math.max(dispP99 ?? 0, s.p99); }
    if (rho[i].unbounded && rho[i].rho >= 1) grow.push(i);
  });
  const holdMs = crit.holdH * 3.6e6;
  const memHitMs = fc.kind === "sim" || fc.kind === "extrap" ? fc.ms : null;
  const fails = [];
  if (keepLoss > 0) fails.push("keepLoss");
  if (memHitMs !== null && memHitMs <= holdMs) fails.push("memory");
  if (dispP99 !== null && dispP99 > crit.p99Ms) fails.push("p99");
  return { rho: rho.map((r) => r.rho), fc, keepLoss, dispDrop, dispP99, grow, memPeakMB: res.memPeakMB, memHitMs, pass: !fails.length, fails };
}

// 한 작업 데이터를 장비 설정 · 초안 설정으로 돌리고, 초안은 '전부 처리' 쌍둥이로 필요한 큐 크기까지 구한다
export function runPair(w, log, active, draft, opt = {}) {
  const cfgD = merge(w, draft), out = { draft: null, active: null, need: null };
  out.draft = { cfg: cfgD, res: simulate(cfgD, log, opt) };
  if (hashOf(active) !== hashOf(draft)) { const cfgA = merge(w, active); out.active = { cfg: cfgA, res: simulate(cfgA, log, { ...opt, onProgress: null }) }; }
  else out.active = out.draft;
  if (opt.twin !== false && cfgD.stages.some((s) => s.policy !== "all")) {
    const tw = simulate(unboundedTwin(cfgD), log, { ...opt, keepLatency: false, onProgress: null });
    out.need = tw.stages.map((s, i) => ({ maxQ: s.maxQ, grows: tw.stages[i].offered / tw.endMs * tw.stages[i].svcMean / tw.stages[i].workers >= 1 }));
  } else { const r = summarize(cfgD, out.draft.res).rho; out.need = out.draft.res.stages.map((s, i) => ({ maxQ: s.maxQ, grows: r[i] >= 1 })); }
  return out;
}

// 전환 가능 여부: 지금 초안으로 서로 다른 작업 데이터 minCases 개 이상을 돌렸고, 그 최신 기록이 모두 기준 통과
export function switchState(records, draftHash, activeHash, crit = CRITERIA) {
  if (draftHash === activeHash) return { ok: false, why: "same" };
  const latest = new Map();
  for (const r of records) if (r.draftHash === draftHash) { const p = latest.get(r.wid); if (!p || p.at < r.at) latest.set(r.wid, r); }
  const list = [...latest.values()];
  const failed = list.filter((r) => !r.draft.pass);
  if (list.length < crit.minCases) return { ok: false, why: "few", n: list.length, need: crit.minCases };
  if (failed.length) return { ok: false, why: "fail", n: failed.length };
  return { ok: true, n: list.length };
}
