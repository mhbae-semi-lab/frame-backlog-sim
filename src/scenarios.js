// 합성 시나리오 3종 (재현 세트 기본 항목). 단계 이름은 같은 키(proc · draw · save)라 하나의 장비 설정을 셋에 그대로 적용한다.
// 수치는 설명용으로 만든 값이며 특정 장비의 측정값이 아니다.

// 검사(처리)와 화면(그리기)은 카메라에서 따로 받고, 저장은 처리가 끝난 프레임을 받는다
const stages = (proc, draw, save) => [
  { name: "proc", from: -1, keep: true, dist: proc },
  { name: "draw", from: -1, keep: false, dist: draw },
  { name: "save", from: 0, keep: true, dist: save },
];

export const SCENARIOS = [
  {
    id: "s-slow-draw", builtin: true, label: "scSlowDraw",
    camera: { mode: "fixed", fps: 30, jitterMs: 0.3, burstN: 100, burstFps: 120, gapMs: 1500 },
    frameMB: 4, baseMB: 2500, durationS: 1800, seed: 17,
    stages: stages({ type: "lognormal", mean: 22, sd: 4 }, { type: "gamma", mean: 36, sd: 12 }, { type: "lognormal", mean: 24, sd: 5 }),
  },
  {
    id: "s-burst", builtin: true, label: "scBurst",
    camera: { mode: "burst", fps: 30, jitterMs: 0.3, burstN: 100, burstFps: 120, gapMs: 1500 },
    frameMB: 4, baseMB: 2500, durationS: 600, seed: 23,
    stages: stages({ type: "lognormal", mean: 15, sd: 4 }, { type: "gamma", mean: 36, sd: 12 }, { type: "lognormal", mean: 12, sd: 3 }),
  },
  {
    id: "s-mem-creep", builtin: true, label: "scMemCreep",
    camera: { mode: "jitter", fps: 30, jitterMs: 0.3, burstN: 100, burstFps: 120, gapMs: 1500 },
    frameMB: 4, baseMB: 2500, durationS: 8 * 3600, seed: 5,
    stages: stages({ type: "lognormal", mean: 20, sd: 4 }, { type: "gamma", mean: 30, sd: 8 }, { type: "lognormal", mean: 33.7, sd: 6 }),
  },
];

// 처음 장비 설정 (v1): 그래버 버퍼 24장 · 놓치면 새 것 버림, 그리기 · 저장은 모든 프레임을 차례로, 메모리 한도 16 GB
export const FIRST_SETTINGS = {
  limitMB: 16384,
  stages: {
    proc: { workers: 1, cap: 24, policy: "dropNew" },
    draw: { workers: 1, cap: 8, policy: "all" },
    save: { workers: 1, cap: 8, policy: "all" },
  },
};

export const clone = (o) => structuredClone(o);
