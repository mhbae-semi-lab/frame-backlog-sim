// 분석식: 카메라 바로 뒤 단계(도착이 카메라 그대로)에서만 쓴다. 단위 ms.
// 정확한 식: M/G/1 (Pollaczek-Khinchine, M/M/1 · M/D/1 포함), M/M/c (Erlang C), D/M/1 (고정 fps 카메라 + 지수 처리)
// 근사: G/G/1 Kingman, G/G/c Allen-Cunneen (도착이 고르면 크게 잡는 편). 들어오는 쪽이 앞 단계 출력이면 분석식을 내지 않는다.
import { simulate } from "./engine.js";

export function erlangC(c, a) { // a = λ/μ (부하, Erlang), c 대 서버가 모두 바쁠 확률
  if (a >= c) return 1;
  let term = 1, sum = 1;
  for (let k = 1; k < c; k++) { term *= a / k; sum += term; }
  const last = (term * a) / c / (1 - a / c);
  return last / (sum + last);
}

// mean: 평균 도착 간격, ca2 · cs2: 도착 간격 · 처리 시간 변동계수 제곱, s: 평균 처리 시간, c: 작업자 수
export function expectedWait({ mean, ca2, s, cs2, c }) {
  const lam = 1 / mean, rho = (lam * s) / c;
  if (!(rho < 1)) return { rho, Wq: Infinity, model: "unstable", exact: false };
  const poisson = Math.abs(ca2 - 1) < 1e-9;
  if (c === 1) {
    const pk = (rho * s * (1 + cs2)) / (2 * (1 - rho));
    if (poisson) return { rho, Wq: pk, model: cs2 === 0 ? "M/D/1" : cs2 === 1 ? "M/M/1" : "M/G/1", exact: true };
    if (ca2 === 0 && cs2 === 1) { // D/M/1: σ = exp(-(1-σ)/ρ) 의 0 < σ < 1 근, Wq = σ·s/(1-σ)
      let sg = 0.5;
      for (let i = 0; i < 2000; i++) { const n = Math.exp(-(1 - sg) / rho); if (Math.abs(n - sg) < 1e-13) { sg = n; break; } sg = n; }
      return { rho, Wq: (sg * s) / (1 - sg), model: "D/M/1", exact: true };
    }
    return { rho, Wq: (rho / (1 - rho)) * ((ca2 + cs2) / 2) * s, model: "G/G/1 Kingman", exact: false };
  }
  const C = erlangC(c, lam * s), base = C / (c / s - lam);
  if (poisson && cs2 === 1) return { rho, Wq: base, model: `M/M/${c}`, exact: true };
  return { rho, Wq: base * ((ca2 + cs2) / 2), model: `G/G/${c} Allen-Cunneen`, exact: false };
}

// 분석식 대조: M/M/1 · M/D/1 · M/M/3 (포아송 도착) · D/M/1 (고정 fps), ρ 0.5 · 0.7 · 0.9, 반복마다 시드만 바꿈
export function accuracy(reps, frames, onProgress) {
  const cases = [];
  for (const [label, type, c, arr] of [["M/M/1", "exp", 1, "poisson"], ["M/D/1", "fixed", 1, "poisson"], ["M/M/3", "exp", 3, "poisson"], ["D/M/1", "exp", 1, "fixed"]])
    for (const rho of [0.5, 0.7, 0.9]) cases.push({ label, type, c, rho, arr });
  const rows = [];
  let done = 0;
  for (const k of cases) {
    const s = 10, mean = s / (k.rho * k.c), vals = [];
    const t0 = performance.now();
    for (let r = 0; r < reps; r++) {
      const cfg = { seed: 1000 + r, frames, camera: { mode: k.arr, fps: 1000 / mean }, frameMB: 0, stages: [{ name: "a", from: -1, workers: k.c, cap: 1, policy: "all", dist: { type: k.type, mean: s } }] };
      vals.push(simulate(cfg, null, { keepLatency: false }).stages[0].waitMean);
      onProgress?.(++done / (cases.length * reps));
    }
    const e = expectedWait({ mean, ca2: k.arr === "poisson" ? 1 : 0, s, cs2: k.type === "exp" ? 1 : 0, c: k.c }).Wq;
    const m = vals.reduce((a, b) => a + b, 0) / reps;
    const sd = reps > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (reps - 1)) : 0;
    rows.push({ ...k, frames, reps, Wq: e, sim: m, err: m / e - 1, first: vals[0] / e - 1, sdRun: sd / e, ms: (performance.now() - t0) / reps });
  }
  return rows;
}
