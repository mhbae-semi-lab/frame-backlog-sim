import test from "node:test";
import assert from "node:assert/strict";
import { parseTiming, parseDateTime, fitDist, detectDelim } from "../src/timing.js";
import { sampleLog } from "../src/gen.js";
import { sampler } from "../src/engine.js";

test("예시 로그: 열 자동 감지 · 시작/끝 쌍 · 깨진 줄 4개의 줄 번호와 이유", () => {
  const r = parseTiming(sampleLog());
  assert.deepEqual(r.names, ["proc", "draw", "save"]);
  assert.equal(r.timeName, "grab_time");
  assert.equal(r.rows, 18000);
  assert.equal(r.arrivals.length, 18000);
  assert.ok(Math.abs(r.arrivals[1] - 33.333) < 0.5);
  assert.deepEqual(r.bad.map((b) => [b.line, b.code]), [[1202, "B_NUM"], [5003, "B_COLS"], [9004, "B_NEG"], [14005, "B_BACK"]]);
  assert.ok(Math.abs(r.cols[0][0] - (r.cols[0][0])) === 0 && r.cols[0].every((v) => v > 0));
});

test("날짜 시각은 µs 까지", () => {
  const a = parseDateTime("2026-11-10 09:00:00.000250"), b = parseDateTime("2026-11-10 09:00:00.001");
  assert.ok(Math.abs(b - a - 0.75) < 1e-6);
  assert.ok(Number.isNaN(parseDateTime("09:00:00")));
});

test("머리글 없는 숫자 CSV: 단조 증가하는 첫 열을 시각(ms)으로", () => {
  const r = parseTiming("0;12.5;30\n33.3;13;31\n66.7;12;29\n100;14;33\n");
  assert.equal(detectDelim(["0;12.5;30", "33.3;13;31"]), ";");
  assert.equal(r.header, false);
  assert.equal(r.rows, 4);
  assert.deepEqual(r.names, ["col2", "col3"]);
  assert.deepEqual(Array.from(r.arrivals), [0, 33.3, 66.7, 100]);
});

test("열 직접 지정 · 단위 · 끝-시작 식 · 없는 열은 오류", () => {
  const text = "t_s,a_start,a_end,b_us\n0.000,1.0,1.5,2500\n0.040,2.0,2.4,2600\n";
  const r = parseTiming(text, { time: "t_s", timeUnit: "s", cols: "a_end-a_start, b_us", durUnit: "s" });
  assert.deepEqual(Array.from(r.arrivals), [0, 40]);
  assert.deepEqual(Array.from(r.cols[0]).map((v) => +v.toFixed(6)), [500, 400]);
  const r2 = parseTiming(text, { time: "1", timeUnit: "s", cols: "4", durUnit: "us" });
  assert.deepEqual(Array.from(r2.cols[0]), [2.5, 2.6]);
  assert.throws(() => parseTiming(text, { cols: "nope" }), (e) => e.message === "E_COL" && e.arg === "nope");
  assert.throws(() => parseTiming("a,b\nx,y\n"), (e) => e.message === "E_NO_ROWS" && e.badCount === 1);
  assert.throws(() => parseTiming("\n\n"), /E_EMPTY/);
});

test("분포 적합: 로그정규 · 감마 표본에서 같은 분포가 가장 잘 맞고 평균 · σ 가 맞다", () => {
  for (const type of ["lognormal", "gamma"]) {
    const f = sampler({ type, mean: 30, sd: 9 }, 5, 1);
    const v = Float64Array.from({ length: 30000 }, (_, k) => f(k));
    const fit = fitDist(v);
    assert.equal(fit.best.type, type);
    assert.ok(Math.abs(fit.best.mean / 30 - 1) < 0.02 && Math.abs(fit.best.sd / 9 - 1) < 0.05, JSON.stringify(fit.best));
  }
  assert.equal(fitDist(new Float64Array([5, 5, 5, 5])).best.type, "fixed");
});
