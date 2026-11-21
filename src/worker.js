// 계산 Worker: 로그 읽기 · 시뮬레이션 · 분석식 대조. 화면은 멈추지 않는다.
import { parseTiming, fitDist } from "./timing.js";
import { runPair, summarize, precheck } from "./model.js";
import { accuracy } from "./analytic.js";

const logs = new Map();
const BINS = 40;

// 지연 히스토그램: 0 ~ p99 × 1.25 (최대보다 크면 최대)를 40칸, 넘는 것은 over
function hist(st) {
  if (!st.lat || !st.lat.length) return null;
  const hi = Math.max(1e-6, Math.min(st.max, st.p99 * 1.25)), bins = new Uint32Array(BINS);
  let over = 0;
  for (const v of st.lat) { const b = Math.floor((v / hi) * BINS); if (b >= BINS) { if (v > hi) over++; else bins[BINS - 1]++; } else bins[b]++; }
  return { hi, bins, over, n: st.lat.length };
}
function pack(r) {
  if (!r) return null;
  const stages = r.res.stages.map((s) => { const { lat, ...rest } = s; return { ...rest, hist: hist(s) }; });
  return { cfg: r.cfg, res: { ...r.res, stages }, sum: summarize(r.cfg, r.res) };
}

self.onmessage = async ({ data }) => {
  const { id } = data;
  try {
    if (data.type === "setLog") { logs.set(data.log.id, data.log); return; }
    if (data.type === "parse") {
      const text = typeof data.text === "string" ? data.text : await decode(data.file, data.encoding);
      const t0 = performance.now();
      const log = parseTiming(text, data.opts || {});
      const fits = log.cols.map((c) => fitDist(c));
      const arr = [log.arrivals?.buffer, ...log.cols.map((c) => c.buffer)].filter(Boolean);
      self.postMessage({ type: "parsed", id, log, fits, ms: performance.now() - t0 }, arr);
      return;
    }
    if (data.type === "run") {
      const log = data.logId ? logs.get(data.logId) : null;
      if (data.logId && !log) throw new Error("E_LOG_MISSING");
      const t0 = performance.now();
      const onProgress = (p) => self.postMessage({ type: "progress", id, p });
      const out = runPair(data.w, log, data.active, data.draft, { onProgress });
      const draft = pack(out.draft);
      const active = out.active === out.draft ? draft : pack(out.active);
      self.postMessage({ type: "done", id, draft, active, need: out.need, pre: precheck(out.draft.cfg, log), ms: performance.now() - t0 });
      return;
    }
    if (data.type === "accuracy") {
      self.postMessage({ type: "done", id, rows: accuracy(data.reps || 10, data.frames || 100000, (p) => self.postMessage({ type: "progress", id, p })) });
      return;
    }
  } catch (e) {
    self.postMessage({ type: "error", id, code: e.message || String(e), arg: e.arg, errors: e.errors, bad: e.bad, badCount: e.badCount });
  }
};

async function decode(file, enc) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (enc && enc !== "auto") return new TextDecoder(enc).decode(buf);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("euc-kr").decode(buf); }
}
