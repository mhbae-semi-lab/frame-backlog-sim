// 예시 타이밍 로그 (합성): 30fps 촬영 10분, 처리는 시작 · 끝 시각, 그리기 · 저장은 ms. 일부러 깨진 줄 4개를 넣는다.
import { sampler, u01 } from "./engine.js";

const pad = (n, w = 2) => String(n).padStart(w, "0");
function stamp(ms) {
  const d = new Date(Date.UTC(2026, 10, 10, 9, 0, 0) + ms);
  const frac = ms - Math.floor(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}${pad(Math.round(frac * 1000) % 1000, 3)}`;
}

export function sampleLog({ minutes = 10, fps = 30, seed = 41 } = {}) {
  const n = Math.round(minutes * 60 * fps), I = 1000 / fps;
  const proc = sampler({ type: "lognormal", mean: 22, sd: 4 }, seed, 1);
  const draw = sampler({ type: "gamma", mean: 36, sd: 12 }, seed, 2);
  const save = sampler({ type: "lognormal", mean: 24, sd: 5 }, seed, 3);
  const out = ["frame,grab_time,proc_start,proc_end,draw_ms,save_ms"];
  for (let k = 0; k < n; k++) {
    const t = k * I + (u01(seed, 9, k, 0) - 0.5) * 0.6;
    const ps = t + 0.4 + u01(seed, 9, k, 1) * 0.3, pe = ps + proc(k);
    out.push(`${k + 1},${stamp(t)},${stamp(ps)},${stamp(pe)},${draw(k).toFixed(3)},${save(k).toFixed(3)}`);
  }
  // 깨진 줄: 숫자 아님 · 열 부족 · 음수 · 시각 역전
  out.splice(1201, 0, "1201,2026-11-10 09:00:40.000000,n/a,n/a,35.1,24.0");
  out.splice(5002, 0, "5001,2026-11-10 09:02:46.700000,34.8");
  out.splice(9003, 0, "9001,2026-11-10 09:05:00.010000,2026-11-10 09:05:00.020000,2026-11-10 09:05:00.040000,-3.0,23.5");
  out.splice(14004, 0, "14001,2026-11-10 09:01:00.000000,2026-11-10 09:01:00.001000,2026-11-10 09:01:00.020000,36.0,24.0");
  return out.join("\n") + "\n";
}
