import test from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS, FIRST_SETTINGS } from "../src/scenarios.js";
import { merge, runPair, summarize, precheck, switchState, diffSettings, hashOf, settingsOf } from "../src/model.js";

const FIX = { limitMB: 16384, stages: { proc: { workers: 1, cap: 64, policy: "dropNew" }, draw: { workers: 1, cap: 8, policy: "latest" }, save: { workers: 2, cap: 8, policy: "all" } } };
const short = (w, h) => ({ ...w, durationS: h * 3600 });

test("합성 시나리오 3종: 처음 설정(v1)은 실패, 고친 설정은 통과", () => {
  const want = { "s-slow-draw": ["memory", "p99"], "s-burst": ["keepLoss", "memory", "p99"], "s-mem-creep": ["memory"] };
  for (const w0 of SCENARIOS) {
    const w = w0.id === "s-mem-creep" ? short(w0, 4) : w0; // 4시간이면 v1 이 한도에 닿는다 (약 2.9시간)
    const out = runPair(w, null, FIRST_SETTINGS, FIX);
    const A = summarize(out.active.cfg, out.active.res), D = summarize(out.draft.cfg, out.draft.res);
    assert.deepEqual(A.fails, want[w0.id], w0.id);
    assert.equal(D.pass, true, `${w0.id} ${D.fails}`);
  }
});

test("그리기 느림: 30fps · 그리기 36 ms 를 모두 그리면 5분에 600장 넘게 쌓이고, 최신만이면 1장", () => {
  const w = { ...SCENARIOS[0], durationS: 300 };
  const all = runPair(w, null, FIRST_SETTINGS, FIRST_SETTINGS);
  const draw = all.draft.res.stages[1];
  assert.ok(draw.waitingEnd > 600, `${draw.waitingEnd}`);
  const latest = runPair(w, null, FIRST_SETTINGS, FIX).draft.res.stages[1];
  assert.equal(latest.maxQ, 1);
});

test("메모리 누적: 저장 평균 33.7 ms vs 촬영 33.3 ms — 한도 16 GB 에 2~4시간 뒤", () => {
  const out = runPair(short(SCENARIOS[2], 4), null, FIRST_SETTINGS, FIRST_SETTINGS, { twin: false });
  const hit = out.draft.res.limitHitMs / 3.6e6;
  assert.ok(hit > 2 && hit < 4, `hit ${hit} h`);
  // 1시간만 돌려도 외삽이 같은 범위를 가리킨다
  const one = runPair(short(SCENARIOS[2], 1), null, FIRST_SETTINGS, FIRST_SETTINGS, { twin: false });
  const s = summarize(one.draft.cfg, one.draft.res);
  assert.equal(s.fc.kind, "extrap");
  assert.ok(Math.abs(s.fc.ms / out.draft.res.limitHitMs - 1) < 0.25, `extrap ${s.fc.ms / 3.6e6} h`);
});

test("버스트: 손실 0 필요 큐는 처음 큐(24)보다 크고, 실행 전 점검이 버스트당 쌓임을 알려 준다", () => {
  const out = runPair(SCENARIOS[1], null, FIRST_SETTINGS, FIRST_SETTINGS);
  assert.ok(out.need[0].maxQ > 24 && out.need[0].maxQ <= 64, `${out.need[0].maxQ}`);
  const pre = precheck(merge(SCENARIOS[1], FIRST_SETTINGS));
  const burst = pre[0].notes.find((n) => n.code === "P_BURST");
  assert.ok(burst && burst.n > 24);
  assert.ok(pre[0].notes.some((n) => n.code === "P_KEEP_DROP"));
});

test("실행 전 점검: 정확식은 카메라 바로 뒤 '전부 처리' 단계에만", () => {
  const w = { ...SCENARIOS[0], camera: { mode: "poisson", fps: 30 } };
  const pre = precheck(merge(w, { limitMB: 0, stages: { proc: { workers: 1, cap: 1, policy: "all" } } }));
  assert.equal(pre[0].ana.model, "M/G/1");
  assert.equal(pre[2].ana, null); // 저장은 처리 뒤
});

test("전환 조건: 같은 초안으로 서로 다른 데이터 3개 이상, 최신 기록이 모두 통과", () => {
  const rec = (wid, pass, at, dh = "d") => ({ wid, at, draftHash: dh, draft: { pass } });
  assert.equal(switchState([], "d", "d").why, "same");
  assert.equal(switchState([rec("a", true, 1), rec("b", true, 2)], "d", "x").why, "few");
  assert.equal(switchState([rec("a", true, 1), rec("b", true, 2), rec("c", false, 3)], "d", "x").why, "fail");
  assert.equal(switchState([rec("a", true, 1), rec("b", true, 2), rec("c", false, 3), rec("c", true, 4)], "d", "x").ok, true);
  assert.equal(switchState([rec("a", true, 1), rec("b", true, 2), rec("c", true, 3, "old")], "d", "x").why, "few");
});

test("설정 비교 · 해시 · 이름별 적용", () => {
  const names = ["proc", "draw", "save"];
  const d = diffSettings(FIRST_SETTINGS, FIX, names).map((x) => x.path);
  assert.deepEqual(d, ["proc.cap", "draw.policy", "save.workers"]); // all · latest 사이의 cap 은 의미 없어 뺀다
  assert.equal(hashOf({ a: 1, b: { c: 2, d: 3 } }), hashOf({ b: { d: 3, c: 2 }, a: 1 }));
  const cfg = merge(SCENARIOS[0], FIX);
  assert.equal(cfg.stages[1].policy, "latest");
  assert.equal(cfg.limitMB, 16384);
  assert.deepEqual(settingsOf(SCENARIOS[0], FIX).stages.save, FIX.stages.save);
});
