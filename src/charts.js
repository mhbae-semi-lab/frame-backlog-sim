// 캔버스 차트 두 가지: 시계열 선(여러 줄 · 한도 선 · 표시 선), 히스토그램(분위수 표시). 색은 CSS 변수에서 읽는다.
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const PALETTE = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6"];
export const seriesColor = (i) => css(PALETTE[i % PALETTE.length]);

function setup(cv, h) {
  const dpr = window.devicePixelRatio || 1, w = Math.max(240, cv.clientWidth || cv.parentElement.clientWidth);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + "px";
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = `12px ${css("--font")}`;
  return { g, w, h };
}

function nice(max) {
  if (!(max > 0)) return { top: 1, step: 0.25 };
  const p = Math.pow(10, Math.floor(Math.log10(max))), r = max / p;
  const step = (r <= 1.5 ? 0.25 : r <= 3 ? 0.5 : r <= 6 ? 1 : 2) * p;
  return { top: Math.ceil(max / step) * step, step };
}

// opt: { series: [{ name, color, data: Float32Array, dash }], dt (ms per point), yFmt, xFmt, hline: { v, label }, vline: { x(ms), label }, yMax, int (정수 눈금) }
export function lineChart(cv, opt, H = 220) {
  const { g, w, h } = setup(cv, H);
  const L = 56, R = 12, T = 12, B = 26, pw = w - L - R, ph = h - T - B;
  const n = Math.max(1, ...opt.series.map((s) => s.data.length));
  let ymax = opt.yMax ?? 0;
  for (const s of opt.series) for (const v of s.data) if (v > ymax) ymax = v;
  if (opt.hline && opt.hline.v > ymax * 0.6 && opt.hline.v < ymax * 3) ymax = Math.max(ymax, opt.hline.v);
  let { top, step } = nice(ymax * 1.05);
  if (opt.int && step < 1) { step = 1; top = Math.max(1, Math.ceil(top)); }
  const X = (i) => L + (i / Math.max(1, n - 1)) * pw, Y = (v) => T + ph - (v / top) * ph;
  g.strokeStyle = css("--line"); g.fillStyle = css("--mid"); g.lineWidth = 1;
  g.textAlign = "right"; g.textBaseline = "middle";
  for (let v = 0; v <= top + 1e-9; v += step) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(L + pw, Y(v)); g.stroke(); g.fillText(opt.yFmt(v), L - 6, Y(v)); }
  g.textAlign = "center"; g.textBaseline = "top";
  const total = n * opt.dt;
  for (let k = 0; k <= 4; k++) { g.textAlign = k === 0 ? "left" : k === 4 ? "right" : "center"; g.fillText(opt.xFmt((total * k) / 4), L + (pw * k) / 4, T + ph + 6); }
  if (opt.hline && opt.hline.v <= top) {
    g.save(); g.setLineDash([5, 4]); g.strokeStyle = css("--red"); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(L, Y(opt.hline.v)); g.lineTo(L + pw, Y(opt.hline.v)); g.stroke(); g.restore();
    g.fillStyle = css("--red-ink"); g.textAlign = "left"; g.textBaseline = "bottom"; g.fillText(opt.hline.label, L + 4, Y(opt.hline.v) - 2);
  }
  if (opt.vline && opt.vline.x <= total) {
    const x = L + (opt.vline.x / total) * pw;
    g.save(); g.strokeStyle = css("--red"); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); g.restore();
    g.fillStyle = css("--red-ink"); g.textAlign = x > L + pw * 0.7 ? "right" : "left"; g.textBaseline = "top"; g.fillText(opt.vline.label, x + (x > L + pw * 0.7 ? -4 : 4), T + 2);
  }
  for (const s of opt.series) {
    g.save(); g.strokeStyle = s.color; g.lineWidth = s.width || 2; if (s.dash) g.setLineDash(s.dash);
    g.beginPath();
    for (let i = 0; i < s.data.length; i++) { const x = X(i), y = Y(Math.min(s.data[i], top)); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.restore();
  }
}

// opt: { bins: Uint32Array, hi, over, marks: [{ v, label }], xFmt, color }
export function histChart(cv, opt, H = 220) {
  const { g, w, h } = setup(cv, H);
  const L = 48, R = 12, T = 18, B = 26, pw = w - L - R, ph = h - T - B;
  const nb = opt.bins.length, max = Math.max(1, ...opt.bins);
  const { top, step } = nice(max * 1.05);
  g.strokeStyle = css("--line"); g.fillStyle = css("--mid"); g.textAlign = "right"; g.textBaseline = "middle";
  for (let v = 0; v <= top + 1e-9; v += step) { const y = T + ph - (v / top) * ph; g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); g.fillText(fmtCount(v), L - 6, y); }
  g.fillStyle = opt.color;
  const bw = pw / nb;
  for (let i = 0; i < nb; i++) { const bh = (opt.bins[i] / top) * ph; g.fillRect(L + i * bw + 1, T + ph - bh, Math.max(1, bw - 2), bh); }
  g.fillStyle = css("--mid"); g.textAlign = "center"; g.textBaseline = "top";
  for (let k = 0; k <= 4; k++) { g.textAlign = k === 0 ? "left" : k === 4 ? "right" : "center"; g.fillText(opt.xFmt((opt.hi * k) / 4), L + (pw * k) / 4, T + ph + 6); }
  g.textBaseline = "bottom";
  opt.marks.forEach((m, j) => {
    if (m.v === null || m.v > opt.hi) return;
    const x = L + (m.v / opt.hi) * pw;
    g.save(); g.setLineDash([3, 3]); g.strokeStyle = css("--ink-2"); g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); g.restore();
    const tw = g.measureText(m.label).width, right = x + 3 + tw > L + pw, tx = x + (right ? -3 : 3), ty = T + 12 + j * 14;
    g.fillStyle = css("--card"); g.globalAlpha = 0.85; g.fillRect(right ? tx - tw - 2 : tx - 2, ty - 13, tw + 4, 14); g.globalAlpha = 1; // 막대 위에서도 읽히게
    g.fillStyle = css("--ink-2"); g.textAlign = right ? "right" : "left";
    g.fillText(m.label, tx, ty);
  });
}

const fmtCount = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + "k" : String(Math.round(v)));
