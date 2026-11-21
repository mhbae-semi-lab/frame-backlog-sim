// 분석식 대조: M/M/1 · M/D/1 · M/M/3 (포아송) · D/M/1 (고정 fps), ρ 0.5 · 0.7 · 0.9, 10만 프레임 × 시드 N개. 결과를 표와 docs/measurements/accuracy.json 으로.
// node tools/accuracy.mjs [시드 수=100]  (10만 프레임 1회는 ρ 0.9 에서 우연에 의한 흔들림이 ±7% 라 시드를 많이 돌려 평균한다)
import { writeFileSync, mkdirSync } from "node:fs";
import { accuracy } from "../src/analytic.js";

const reps = +(process.argv[2] || 100);
const t0 = performance.now();
const rows = accuracy(reps, 100000, () => {});
console.log(`model   rho  analytic Wq  sim mean(${reps})  err(mean)  err(seed 1)  sd of 1 run`);
for (const r of rows) console.log(`${r.label.padEnd(6)} ${r.rho.toFixed(1)}  ${r.Wq.toFixed(3).padStart(10)}  ${r.sim.toFixed(3).padStart(14)}  ${(r.err * 100).toFixed(2).padStart(8)}%  ${(r.first * 100).toFixed(2).padStart(9)}%  ${(r.sdRun * 100).toFixed(2).padStart(9)}%`);
const worst = Math.max(...rows.map((r) => Math.abs(r.err)));
console.log(`worst |err| of mean: ${(worst * 100).toFixed(2)}%  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
mkdirSync(new URL("../docs/measurements/", import.meta.url), { recursive: true });
writeFileSync(new URL("../docs/measurements/accuracy.json", import.meta.url), JSON.stringify({ frames: 100000, reps, node: process.versions.node, rows }, null, 1));
