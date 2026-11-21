import test from "node:test";
import assert from "node:assert/strict";
import { simulate, quantiles, memoryForecast, loads, arrivals, arrivalStats, unboundedTwin } from "../src/engine.js";
import { expectedWait, erlangC } from "../src/analytic.js";

const one = (policy, cap, extra = {}) => ({
  seed: 1, durationS: 1, camera: { mode: "fixed", fps: 100 }, frameMB: 1, baseMB: 0, limitMB: 0,
  stages: [{ name: "a", from: -1, workers: 1, cap, policy, dist: { type: "fixed", mean: 15 } }], ...extra,
});

// 단일 단계 · 고정 간격 · 고정 처리 시간의 참조 구현 (엔진과 따로 짠 단순 루프)
function reference(I, S, T, policy, cap) {
  const arr = [];
  for (let t = 0; t < T; t += I) arr.push(+t.toFixed(9));
  let busyUntil = -1, q = [], served = 0, dropped = 0, maxQ = 0, cur = null;
  // 시각 순서대로: 같은 시각이면 완료 먼저
  let i = 0;
  for (;;) {
    const nextArr = i < arr.length ? arr[i] : Infinity, nextDone = cur !== null ? busyUntil : Infinity;
    const t = Math.min(nextArr, nextDone);
    if (!(t < T)) break;
    if (nextDone <= nextArr) {
      served++; cur = null;
      if (q.length) { cur = q.shift(); busyUntil = t + S; }
    } else {
      i++;
      if (cur === null) { cur = t; busyUntil = t + S; }
      else if (policy === "all" || q.length < (policy === "latest" ? 1 : cap)) q.push(t);
      else if (policy === "latest" || policy === "dropOld") { q.shift(); q.push(t); dropped++; }
      else dropped++;
      maxQ = Math.max(maxQ, q.length);
    }
  }
  return { served, dropped, maxQ, remaining: q.length + (cur !== null ? 1 : 0), offered: i };
}

test("단일 단계: 정책별로 참조 구현과 같은 수", () => {
  for (const [policy, cap] of [["all", 1], ["latest", 1], ["dropOld", 3], ["dropNew", 3], ["block", 3]]) {
    const r = simulate(one(policy, cap)).stages[0];
    const ref = reference(10, 15, 1000, policy === "block" ? "dropNew" : policy, cap); // 카메라 바로 뒤 막기 = 새 것 버림
    assert.deepEqual({ served: r.served, dropped: r.dropped, maxQ: r.maxQ, remaining: r.remaining, offered: r.offered }, ref, policy);
  }
});

test("고정 간격 10 ms · 처리 15 ms 전부 처리: 1초 뒤 66장 처리, 34장 남음", () => {
  const r = simulate(one("all", 1));
  assert.equal(r.frames, 100);
  assert.equal(r.stages[0].served, 66);
  assert.equal(r.stages[0].remaining, 34);
  assert.equal(r.aliveEnd, 34);
  assert.equal(r.memEndMB, 34);
});

test("막기: 뒤 단계는 버리지 않고 앞 단계 대기열이 쌓인다 · 단계마다 프레임 수 보존", () => {
  const cfg = {
    seed: 3, durationS: 10, camera: { mode: "fixed", fps: 100 }, frameMB: 1, baseMB: 0, limitMB: 0,
    stages: [
      { name: "a", from: -1, workers: 1, cap: 1, policy: "all", dist: { type: "fixed", mean: 5 } },
      { name: "b", from: 0, workers: 1, cap: 2, policy: "block", dist: { type: "fixed", mean: 20 } },
    ],
  };
  const r = simulate(cfg);
  const [a, b] = r.stages;
  assert.equal(b.dropped, 0);
  assert.equal(b.maxQ, 2);
  assert.ok(b.blocked > 0);
  assert.ok(a.maxQ > 400, `a.maxQ ${a.maxQ}`);
  for (const s of r.stages) assert.equal(s.offered, s.served + s.dropped + s.remaining, s.name);
  assert.equal(b.offered, a.served); // 막힌 프레임도 뒤 단계에 '들어온 것'으로 센다
});

test("갈래(fan-out): 두 단계가 같은 프레임을 잡아도 메모리는 한 장으로", () => {
  const cfg = {
    seed: 1, durationS: 1, camera: { mode: "fixed", fps: 100 }, frameMB: 10, baseMB: 100, limitMB: 0,
    stages: [
      { name: "a", from: -1, workers: 1, cap: 1, policy: "all", dist: { type: "fixed", mean: 5 } },
      { name: "b", from: -1, workers: 1, cap: 1, policy: "all", dist: { type: "fixed", mean: 6 } },
    ],
  };
  const r = simulate(cfg);
  assert.equal(r.alivePeak, 1);
  assert.equal(r.memPeakMB, 110);
});

test("시드: 같으면 같은 결과, 다른 단계 설정을 바꿔도 앞 단계 결과는 그대로 (공통 난수)", () => {
  const base = {
    seed: 9, durationS: 60, camera: { mode: "poisson", fps: 30 }, frameMB: 1, baseMB: 0, limitMB: 0,
    stages: [
      { name: "a", from: -1, workers: 1, cap: 1, policy: "all", dist: { type: "lognormal", mean: 25, sd: 6 } },
      { name: "b", from: -1, workers: 1, cap: 1, policy: "all", dist: { type: "gamma", mean: 36, sd: 12 } },
    ],
  };
  const r1 = simulate(base), r2 = simulate(base);
  assert.deepEqual(r1.stages[0].p99, r2.stages[0].p99);
  const r3 = simulate({ ...base, stages: [base.stages[0], { ...base.stages[1], policy: "latest" }] });
  assert.equal(r3.stages[0].p99, r1.stages[0].p99);
  assert.equal(r3.stages[0].waitMean, r1.stages[0].waitMean);
  assert.notEqual(r3.stages[1].p99, r1.stages[1].p99);
  const r4 = simulate({ ...base, seed: 10 });
  assert.notEqual(r4.stages[0].p99, r1.stages[0].p99);
});

test("분석식 대조: M/M/1 · M/D/1 · M/M/3 (ρ 0.7, 20만 프레임 × 시드 3, 평균 오차 3% 이내)", () => {
  for (const [type, c] of [["exp", 1], ["fixed", 1], ["exp", 3]]) {
    const s = 10, rho = 0.7, mean = s / (rho * c);
    let sum = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const cfg = { seed, frames: 200000, camera: { mode: "poisson", fps: 1000 / mean }, frameMB: 0, stages: [{ name: "a", from: -1, workers: c, cap: 1, policy: "all", dist: { type, mean: s } }] };
      sum += simulate(cfg, null, { keepLatency: false }).stages[0].waitMean;
    }
    const e = expectedWait({ mean, ca2: 1, s, cs2: type === "exp" ? 1 : 0, c });
    assert.ok(e.exact);
    const err = sum / 3 / e.Wq - 1;
    assert.ok(Math.abs(err) < 0.03, `${e.model} err ${(err * 100).toFixed(2)}%`);
  }
});

test("D/M/1 정확식: 고정 fps 카메라 + 지수 처리 (ρ 0.8, 20만 프레임 × 시드 3, 3% 이내)", () => {
  const s = 10, mean = s / 0.8, e = expectedWait({ mean, ca2: 0, s, cs2: 1, c: 1 });
  assert.equal(e.model, "D/M/1");
  let sum = 0;
  for (let seed = 1; seed <= 3; seed++) sum += simulate({ seed, frames: 200000, camera: { mode: "fixed", fps: 1000 / mean }, frameMB: 0, stages: [{ name: "a", from: -1, workers: 1, cap: 1, policy: "all", dist: { type: "exp", mean: s } }] }, null, { keepLatency: false }).stages[0].waitMean;
  assert.ok(Math.abs(sum / 3 / e.Wq - 1) < 0.03, `${sum / 3} vs ${e.Wq}`);
});

test("Erlang C: 알려진 값 (c=2, a=1 → 1/3)", () => {
  assert.ok(Math.abs(erlangC(2, 1) - 1 / 3) < 1e-12);
  assert.ok(Math.abs(erlangC(1, 0.5) - 0.5) < 1e-12);
});

test("메모리 한도: 기간 안이면 시뮬 시각, 짧게 돌리면 외삽", () => {
  // 들어옴 100 fps, 처리 80 fps → 초당 20장 × 1 MB 증가, 한도 1000 MB → 약 50초
  const cfg = (d) => ({ seed: 1, durationS: d, camera: { mode: "fixed", fps: 100 }, frameMB: 1, baseMB: 0, limitMB: 1000,
    stages: [{ name: "a", from: -1, workers: 1, cap: 1, policy: "all", dist: { type: "fixed", mean: 12.5 } }] });
  const long = simulate(cfg(100));
  assert.ok(Math.abs(long.limitHitMs - 50000) < 200, `hit ${long.limitHitMs}`);
  const c20 = cfg(20), short = simulate(c20);
  assert.equal(short.limitHitMs, null);
  const fc = memoryForecast(short, loads(c20, short));
  assert.equal(fc.kind, "extrap");
  assert.ok(Math.abs(fc.ms / 50000 - 1) < 0.02, `extrap ${fc.ms}`);
  // 안정이면 외삽하지 않는다
  const c3 = { ...c20, stages: [{ ...c20.stages[0], dist: { type: "fixed", mean: 8 } }] }, st = simulate(c3);
  assert.equal(memoryForecast(st, loads(c3, st)).kind, "stable");
});

test("분위수: quickselect 가 정렬과 같은 값", () => {
  const a = Float32Array.from({ length: 10001 }, (_, i) => Math.sin(i * 12.9898) * 1000);
  const sorted = a.slice().sort();
  const q = quantiles(a.slice(), [0.5, 0.95, 0.99]);
  assert.deepEqual(q, [0.5, 0.95, 0.99].map((p) => sorted[Math.floor(p * sorted.length)]));
});

test("버스트 도착: 시각과 평균 간격", () => {
  const cam = { mode: "burst", burstN: 4, burstFps: 100, gapMs: 60 };
  const f = arrivals(cam, 1);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(f), [0, 10, 20, 30, 100, 110]);
  assert.ok(Math.abs(arrivalStats(cam).mean - 25) < 1e-9);
});

test("쌍둥이(전부 처리)로 손실 0 에 필요한 큐 크기", () => {
  const cfg = { seed: 2, durationS: 30, camera: { mode: "burst", burstN: 50, burstFps: 200, gapMs: 500 }, frameMB: 1, baseMB: 0, limitMB: 0,
    stages: [{ name: "a", from: -1, workers: 1, cap: 5, policy: "dropNew", dist: { type: "fixed", mean: 8 } }] };
  const need = simulate(unboundedTwin(cfg)).stages[0].maxQ;
  assert.ok(simulate(cfg).stages[0].dropped > 0);
  assert.equal(simulate({ ...cfg, stages: [{ ...cfg.stages[0], cap: need }] }).stages[0].dropped, 0);
  assert.ok(simulate({ ...cfg, stages: [{ ...cfg.stages[0], cap: need - 1 }] }).stages[0].dropped > 0);
});

test("설정 오류는 경로와 코드로", () => {
  assert.throws(() => simulate({ ...one("dropOld", 0) }), (e) => e.errors.some((x) => x.path === "stages.0.cap" && x.code === "E_CAP"));
  assert.throws(() => simulate({ ...one("all", 1), stages: [{ ...one("all", 1).stages[0], from: 0 }] }), (e) => e.errors[0].code === "E_FROM");
});
