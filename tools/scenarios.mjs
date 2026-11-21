// 합성 시나리오 3종 결과표: 처음 설정(v1)과 고친 설정. docs/measurements/scenarios.json 으로도 남긴다.
// node tools/scenarios.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { SCENARIOS, FIRST_SETTINGS } from "../src/scenarios.js";
import { runPair, summarize } from "../src/model.js";

export const FIXED = { limitMB: 16384, stages: { proc: { workers: 1, cap: 64, policy: "dropNew" }, draw: { workers: 1, cap: 8, policy: "latest" }, save: { workers: 2, cap: 8, policy: "all" } } };
const h = (ms) => (ms == null ? "-" : ms < 3.6e6 ? `${(ms / 60000).toFixed(1)} min` : `${(ms / 3.6e6).toFixed(2)} h`);
const out = [];
for (const w of SCENARIOS) {
  const t = performance.now();
  const r = runPair(w, null, FIRST_SETTINGS, FIXED);
  const ms = performance.now() - t;
  const row = { id: w.id, frames: r.draft.res.frames, ms: Math.round(ms), need: r.need };
  for (const [k, x] of [["v1", r.active], ["fixed", r.draft]]) {
    const s = summarize(x.cfg, x.res);
    row[k] = {
      pass: s.pass, fails: s.fails, keepLoss: s.keepLoss, dispDrop: s.dispDrop, dispP99: s.dispP99, memPeakMB: Math.round(s.memPeakMB), memHit: s.fc.kind === "sim" || s.fc.kind === "extrap" ? { kind: s.fc.kind, ms: s.fc.ms } : null,
      rho: s.rho.map((v) => +v.toFixed(3)), stages: x.res.stages.map((st) => ({ name: st.name, dropped: st.dropped, maxQ: st.maxQ, p99: st.p99 && +st.p99.toFixed(1) })),
    };
  }
  out.push(row);
  console.log(`\n${w.id}  (${row.frames.toLocaleString()} frames, v1 + fixed + twin ${row.ms} ms)`);
  for (const k of ["v1", "fixed"]) {
    const s = row[k];
    console.log(`  ${k.padEnd(5)} ${s.pass ? "PASS" : "FAIL"} ${s.fails.join(",").padEnd(22)} keepLoss ${String(s.keepLoss).padStart(5)}  dispP99 ${(s.dispP99 / 1000).toFixed(3).padStart(8)} s  memPeak ${(s.memPeakMB / 1024).toFixed(2)} GB  limit ${s.memHit ? s.memHit.kind + " " + h(s.memHit.ms) : "not reached"}  maxQ ${s.stages.map((x) => x.maxQ).join("/")}`);
  }
  console.log(`  zero-loss queue (twin max waiting): ${r.need.map((n) => (n.grows ? "grows" : n.maxQ)).join(" / ")}`);
}
mkdirSync(new URL("../docs/measurements/", import.meta.url), { recursive: true });
writeFileSync(new URL("../docs/measurements/scenarios.json", import.meta.url), JSON.stringify({ node: process.versions.node, settings: { v1: FIRST_SETTINGS, fixed: FIXED }, rows: out }, null, 1));
