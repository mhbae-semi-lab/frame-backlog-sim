// 타이밍 로그 CSV 읽기와 분포 적합.
// 한 줄 = 한 프레임. 촬영 시각 열(선택) + 단계별 처리 시간 열. 끝 - 시작 열 쌍(proc_start, proc_end)은 처리 시간으로 바꾼다.
// 읽지 못한 줄은 줄 번호 · 이유를 남기고 건너뛴다.

const TIME_NAMES = /^(t|ts|time|timestamp|time_?ms|grab(_?time|_?ts)?(_?ms)?|capture(_?time|_?ts)?(_?ms)?|acq(_?time)?|촬영(시각|시간)?|시각|시간)$/i;
const ID_NAMES = /^(frame(_?id|_?no)?|id|no|idx|index|seq|번호|프레임)$/i;
const PAIR = /^(.*?)[_ .-]?(start|begin|end|stop|시작|끝|종료)(_?(ms|us|s))?$/i;
const DATETIME = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?/;

export function detectDelim(lines) {
  let best = ",", score = -1;
  for (const d of [",", "\t", ";", "|"]) {
    const counts = lines.slice(0, 20).map((l) => l.split(d).length);
    const c = counts[0];
    const s = c > 1 && counts.every((x) => x === c) ? c * 10 : counts.reduce((a, b) => a + b, 0) / counts.length;
    if (s > score) { score = s; best = d; }
  }
  return best;
}

const isNum = (s) => s !== "" && Number.isFinite(Number(s));

// 날짜 시각 → ms. 연속한 줄은 "날짜 시:분:" 앞부분이 같으므로 그 값을 재사용한다 (100만 줄에서 몇 배 빠름)
const DT_HEAD = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2}):/;
const DT_TAIL = /^(\d{2})(?:[.,](\d{1,9}))?/;
let headKey = null, headMs = 0;
export function parseDateTime(s) {
  if (headKey === null || !s.startsWith(headKey)) {
    const m = DT_HEAD.exec(s);
    if (!m) return NaN;
    headKey = m[0]; headMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  }
  const t = DT_TAIL.exec(s.slice(headKey.length));
  if (!t) return NaN;
  return headMs + +t[1] * 1000 + (t[2] ? Number("0." + t[2]) * 1000 : 0);
}

const UNIT = { ms: 1, s: 1000, us: 0.001 };

// 열 지정: 이름 또는 1부터 세는 번호, 끝-시작은 "b-a"
function resolve(spec, header) {
  const one = (x) => {
    x = x.trim();
    if (/^\d+$/.test(x)) { const i = +x - 1; return i >= 0 && (!header || i < header.length) ? i : -1; }
    return header ? header.findIndex((h) => h.trim().toLowerCase() === x.toLowerCase()) : -1;
  };
  const diff = /^(.+?)\s*-\s*(.+)$/.exec(spec);
  if (diff && one(spec) < 0) { const a = one(diff[1]), b = one(diff[2]); return a >= 0 && b >= 0 ? { end: a, start: b } : null; }
  const i = one(spec);
  return i >= 0 ? { col: i } : null;
}

// opts: { delim: 'auto', header: 'auto'|true|false, time: ''|'none'|spec, timeUnit: 'auto'|'ms'|'s'|'us'|'datetime', durUnit: 'ms'|'s'|'us', cols: '' | "a, b-c, ..." }
// 결과: { names, arrivals (ms, 0 부터) | null, cols: [Float64Array ms], rows, bad: [{ line, code, arg, text }], badCount, delim, header, timeName }
export function parseTiming(text, opts = {}) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const raw = text.split(/\r?\n/);
  const first = [];
  for (let i = 0; i < raw.length && first.length < 20; i++) { const l = raw[i].trim(); if (l && !l.startsWith("#")) first.push(raw[i]); }
  if (!first.length) throw new Error("E_EMPTY");
  const delim = !opts.delim || opts.delim === "auto" ? detectDelim(first) : opts.delim;
  const cells0 = first[0].split(delim).map((s) => s.trim());
  const header = opts.header === true || opts.header === false ? (opts.header ? cells0 : null) : cells0.some((c) => c && !isNum(c) && !DATETIME.test(c)) ? cells0 : null;
  const width = cells0.length;
  const names = header || cells0.map((_, i) => `col${i + 1}`);

  // 시각 열
  let tcol = null, timeName = null;
  if (opts.time === "none") tcol = null;
  else if (opts.time) { tcol = resolve(opts.time, names); if (!tcol) throw Object.assign(new Error("E_COL"), { arg: opts.time }); timeName = opts.time; }
  else if (header) { const i = header.findIndex((h) => TIME_NAMES.test(h.trim())); if (i >= 0) { tcol = { col: i }; timeName = header[i]; } }
  else { // 머리글이 없으면 첫 열이 단조 증가하는 숫자 또는 날짜 시각일 때 시각으로 본다
    const v = first.slice(0, 10).map((l) => l.split(delim)[0].trim());
    const dt = v.every((s) => DATETIME.test(s)), nums = v.map(Number);
    if (dt || (nums.every(Number.isFinite) && nums.every((x, i) => i === 0 || x >= nums[i - 1]) && nums[nums.length - 1] > nums[0])) { tcol = { col: 0 }; timeName = names[0]; }
  }
  // 처리 시간 열
  let specs = [];
  if (opts.cols && opts.cols.trim()) {
    for (const s of opts.cols.split(",").map((x) => x.trim()).filter(Boolean)) {
      const r = resolve(s, names);
      if (!r) throw Object.assign(new Error("E_COL"), { arg: s });
      specs.push({ ...r, name: s.replace(/\s+/g, "") });
    }
  } else {
    const used = new Set(tcol ? [tcol.col, tcol.end, tcol.start].filter((x) => x !== undefined) : []);
    const pairs = new Map();
    names.forEach((n, i) => {
      if (used.has(i) || ID_NAMES.test(n.trim())) return;
      const m = header ? PAIR.exec(n.trim()) : null;
      if (m && m[1]) {
        const key = m[1].toLowerCase(), p = pairs.get(key) || { name: m[1] };
        if (/start|begin|시작/i.test(m[2])) p.start = i; else p.end = i;
        pairs.set(key, p);
      } else specs.push({ col: i, name: n.trim().replace(/[_ ]?(ms|us|sec|s)$/i, "") || n });
    });
    for (const p of pairs.values()) {
      if (p.start !== undefined && p.end !== undefined) specs.push({ start: p.start, end: p.end, name: p.name });
      else specs.push({ col: p.start ?? p.end, name: names[p.start ?? p.end] });
    }
    specs.sort((a, b) => (a.col ?? a.start) - (b.col ?? b.start));
  }
  if (!specs.length) throw new Error("E_NO_COLS");

  const du = UNIT[opts.durUnit || "ms"] ?? 1;
  let tu = opts.timeUnit || "auto";
  const cols = specs.map(() => new Float64Array(1024));
  let times = tcol ? new Float64Array(1024) : null;
  let n = 0, lastT = -Infinity;
  const bad = [];
  let badCount = 0;
  const fail = (line, code, arg, text) => { badCount++; if (bad.length < 500) bad.push({ line, code, arg, text: text.slice(0, 160) }); };
  const grow = (a) => { const b = new Float64Array(a.length * 2); b.set(a); return b; };

  let started = false;
  for (let li = 0; li < raw.length; li++) {
    const line = raw[li];
    const tr = line.trim();
    if (!tr || tr.startsWith("#")) continue;
    if (!started) { started = true; if (header) continue; }
    const cells = line.split(delim).map((s) => s.trim());
    if (cells.length < width) { fail(li + 1, "B_COLS", `${cells.length}/${width}`, line); continue; }
    let t = 0;
    if (tcol) {
      const s = cells[tcol.col];
      if (tu === "auto") tu = DATETIME.test(s) ? "datetime" : "ms";
      t = tu === "datetime" ? parseDateTime(s) : Number(s) * (UNIT[tu] ?? 1);
      if (!Number.isFinite(t) || s === "") { fail(li + 1, "B_TIME", s, line); continue; }
      if (t < lastT) { fail(li + 1, "B_BACK", s, line); continue; }
    }
    const row = new Array(specs.length);
    let ok = true;
    for (let j = 0; j < specs.length; j++) {
      const sp = specs[j];
      let v;
      if (sp.col !== undefined) {
        const s = cells[sp.col];
        v = Number(s) * du;
        if (s === "" || !Number.isFinite(v)) { fail(li + 1, "B_NUM", `${names[sp.col]}=${s}`, line); ok = false; break; }
      } else {
        const a = cells[sp.end], b = cells[sp.start];
        if (sp.dt === undefined) sp.dt = DATETIME.test(a); // 열마다 첫 줄로 날짜 시각인지 정한다
        const ta = sp.dt ? parseDateTime(a) : Number(a) * du, tb = sp.dt ? parseDateTime(b) : Number(b) * du;
        v = ta - tb;
        if (a === "" || b === "" || !Number.isFinite(v)) { fail(li + 1, "B_NUM", `${sp.name}=${a}-${b}`, line); ok = false; break; }
      }
      if (v <= 0) { fail(li + 1, "B_NEG", `${sp.name}=${v}`, line); ok = false; break; }
      row[j] = v;
    }
    if (!ok) continue;
    if (n === cols[0].length) { for (let j = 0; j < cols.length; j++) cols[j] = grow(cols[j]); if (times) times = grow(times); }
    for (let j = 0; j < specs.length; j++) cols[j][n] = row[j];
    if (times) { times[n] = t; lastT = t; }
    n++;
  }
  if (!n) throw Object.assign(new Error("E_NO_ROWS"), { bad, badCount });
  let arrivals = null;
  if (times && n >= 2) {
    arrivals = times.slice(0, n);
    const t0 = arrivals[0];
    for (let i = 0; i < n; i++) arrivals[i] -= t0;
    if (!(arrivals[n - 1] > 0)) arrivals = null;
  }
  return {
    names: specs.map((s) => s.name), cols: cols.map((c) => c.slice(0, n)), arrivals, rows: n,
    bad, badCount, delim, header: !!header, timeName: arrivals ? timeName : null, timeUnit: tu,
  };
}

// ---------- 분포 적합 ----------
function erf(x) { // Abramowitz-Stegun 7.1.26
  const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
const normCdf = (x, m, s) => 0.5 * (1 + erf((x - m) / (s * Math.SQRT2)));
function lnGamma(z) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function gammaP(a, x) { // 정규화된 하부 불완전 감마
  if (x <= 0) return 0;
  const gln = lnGamma(a);
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
    return sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gln) * h;
}

export function describe(values) {
  const n = values.length;
  let s = 0, s2 = 0, sl = 0, sl2 = 0;
  for (let i = 0; i < n; i++) { const v = values[i]; s += v; s2 += v * v; const l = Math.log(v); sl += l; sl2 += l * l; }
  const mean = s / n, sd = Math.sqrt(Math.max(0, s2 / n - mean * mean));
  const lm = sl / n, ls = Math.sqrt(Math.max(0, sl2 / n - lm * lm));
  const step = Math.max(1, Math.floor(n / 50000));
  const sorted = Float64Array.from({ length: Math.floor(n / step) }, (_, i) => values[i * step]).sort();
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { n, mean, sd, lm, ls, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted[sorted.length - 1], min: sorted[0], sorted };
}

// 정규 · 로그정규 · 감마 후보와 KS 거리. 가장 작은 것이 best
export function fitDist(values) {
  const d = describe(values);
  const { mean, sd, sorted } = d;
  const cands = [];
  if (sd / mean < 0.005) cands.push({ type: "fixed", mean, sd: 0, ks: 0 });
  else {
    const lnMean = Math.exp(d.lm + d.ls * d.ls / 2), lnSd = lnMean * Math.sqrt(Math.exp(d.ls * d.ls) - 1);
    const shape = (mean * mean) / (sd * sd), scale = (sd * sd) / mean;
    const models = [
      { type: "normal", mean, sd, cdf: (x) => normCdf(x, mean, sd) },
      { type: "lognormal", mean: lnMean, sd: lnSd, cdf: (x) => normCdf(Math.log(x), d.lm, d.ls) },
      { type: "gamma", mean, sd, cdf: (x) => gammaP(shape, x / scale) },
    ];
    const m = sorted.length;
    for (const md of models) {
      let ks = 0;
      for (let i = 0; i < m; i++) { const F = md.cdf(sorted[i]); ks = Math.max(ks, Math.abs(F - i / m), Math.abs((i + 1) / m - F)); }
      cands.push({ type: md.type, mean: md.mean, sd: md.sd, ks });
    }
    cands.sort((a, b) => a.ks - b.ks);
  }
  return { stats: { n: d.n, mean, sd, p50: d.p50, p95: d.p95, p99: d.p99, max: d.max, min: d.min }, cands, best: cands[0] };
}
