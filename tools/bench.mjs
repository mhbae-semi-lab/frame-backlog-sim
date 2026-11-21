// 성능 측정: 100만 프레임 · 3단계(처리 → 저장, 그리기는 카메라에서 갈래)를 5번 돌려 최소 · 중앙값을 낸다.
// node tools/bench.mjs [프레임 수=1000000] [반복=5]
import { simulate } from "../src/engine.js";

const n = +(process.argv[2] || 1e6), reps = +(process.argv[3] || 5);
const cfg = {
  seed: 7, durationS: n / 30, camera: { mode: "fixed", fps: 30 }, frameMB: 4, baseMB: 2500, limitMB: 16384,
  stages: [
    { name: "proc", from: -1, workers: 1, cap: 64, policy: "dropNew", keep: true, dist: { type: "lognormal", mean: 22, sd: 4 } },
    { name: "draw", from: -1, workers: 1, cap: 1, policy: "latest", dist: { type: "gamma", mean: 36, sd: 12 } },
    { name: "save", from: 0, workers: 2, cap: 8, policy: "all", keep: true, dist: { type: "lognormal", mean: 24, sd: 5 } },
  ],
};
const ms = [];
let frames = 0;
for (let i = 0; i < reps; i++) {
  const t = performance.now();
  frames = simulate(cfg).frames;
  ms.push(performance.now() - t);
}
ms.sort((a, b) => a - b);
console.log(`${frames.toLocaleString()} frames x 3 stages: min ${ms[0].toFixed(0)} ms, median ${ms[Math.floor(reps / 2)].toFixed(0)} ms (${reps} runs, Node ${process.versions.node})`);
