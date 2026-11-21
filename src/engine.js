// 이산 사건 엔진: 카메라 도착 → 단계(트리 연결) → 단계마다 대기열과 넘칠 때 정책.
// 난수는 (시드, 흐름, 프레임 번호)로 정해진다. 그래서 설정 A 와 B 에서 같은 프레임은 같은 도착 시각 · 같은 처리 시간을 받는다.
// 시간 단위는 ms.

export const POLICIES = ["all", "latest", "dropOld", "dropNew", "block"];
export const DISTS = ["fixed", "normal", "lognormal", "gamma", "exp", "log"];
export const ARRIVALS = ["fixed", "jitter", "poisson", "burst", "log"];
const MAX_FRAMES = 30e6;

// ---------- 난수: 카운터 기반 해시 (lowbias32) ----------
function mix(x) {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
const streamKey = (seed, stream) => mix((seed ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0);
const uk = (sk, k, j) => (mix(mix(sk ^ k) ^ Math.imul(j + 1, 0x85ebca6b)) + 0.5) / 4294967296;
export const u01 = (seed, stream, k, j) => uk(streamKey(seed, stream), k, j);
// 표준 정규: 균등 난수 하나를 역 CDF 로 (Acklam 근사, 상대 오차 1.2e-9). 가운데 95% 는 다항식만 써서 빠르다
const A = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
const B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
const C = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
export function normInv(p) {
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1); }
  if (p > 0.97575) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
}
const gauss = (sk, k, j) => normInv(uk(sk, k, j));

function gammaDraw(shape, sk, k) {
  // Marsaglia-Tsang. shape < 1 은 shape+1 로 뽑고 u^(1/shape) 를 곱한다
  const boost = shape < 1 ? Math.pow(uk(sk, k, 97), 1 / shape) : 1;
  const a = shape < 1 ? shape + 1 : shape, d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (let j = 0; j < 60; j += 3) {
    const z = gauss(sk, k, j);
    const v = (1 + c * z) ** 3;
    if (v <= 0) continue;
    const u = uk(sk, k, j + 2), z2 = z * z;
    if (u < 1 - 0.0331 * z2 * z2 || Math.log(u) < 0.5 * z2 + d - d * v + d * Math.log(v)) return d * v * boost; // 앞은 로그 없이 받는 빠른 판정
  }
  return d * boost;
}

// 분포 → 프레임 번호 k 를 받아 처리 시간(ms)을 돌려주는 함수
export function sampler(dist, seed, stream, log) {
  const m = +dist.mean, sd = Math.max(0, +dist.sd || 0), sk = streamKey(seed, stream);
  switch (dist.type) {
    case "fixed": return () => m;
    case "exp": return (k) => -m * Math.log(uk(sk, k, 0));
    case "normal": return (k) => {
      for (let j = 0; j < 40; j += 2) { const v = m + sd * gauss(sk, k, j); if (v > 0) return v; }
      return m;
    };
    case "lognormal": {
      if (!sd) return () => m;
      const s2 = Math.log(1 + (sd * sd) / (m * m)), mu = Math.log(m) - s2 / 2, sg = Math.sqrt(s2);
      return (k) => Math.exp(mu + sg * gauss(sk, k, 0));
    }
    case "gamma": {
      if (!sd) return () => m;
      const shape = (m * m) / (sd * sd), scale = (sd * sd) / m;
      return (k) => scale * gammaDraw(shape, sk, k);
    }
    case "log": {
      const col = log?.cols?.[dist.col];
      if (!col || !col.length) throw new Error("E_LOG_COL");
      const n = col.length;
      return dist.mode === "sample" ? (k) => col[Math.floor(uk(sk, k, 0) * n)] : (k) => col[k % n];
    }
    default: throw new Error("E_DIST");
  }
}

// 도착: 프레임 번호 순서대로 부르면 촬영 시각(ms)을 돌려준다
export function arrivals(cam, seed, log) {
  const I = 1000 / cam.fps, sk = streamKey(seed, 0);
  switch (cam.mode) {
    case "fixed": return (k) => k * I;
    case "jitter": {
      const sd = Math.max(0, +cam.jitterMs || 0), lim = 0.45 * I;
      return (k) => k * I + Math.max(-lim, Math.min(lim, sd * gauss(sk, k, 0)));
    }
    case "poisson": {
      let t = 0;
      return (k) => (k === 0 ? (t = 0) : (t += -I * Math.log(uk(sk, k, 0))));
    }
    case "burst": {
      const n = Math.max(1, Math.round(cam.burstN)), ib = 1000 / cam.burstFps, per = n * ib + Math.max(0, +cam.gapMs || 0);
      return (k) => Math.floor(k / n) * per + (k % n) * ib;
    }
    case "log": {
      const a = log?.arrivals;
      if (!a || a.length < 2) throw new Error("E_LOG_TIME");
      const n = a.length, per = a[n - 1] - a[0] + (a[n - 1] - a[0]) / (n - 1);
      return (k) => a[k % n] - a[0] + Math.floor(k / n) * per;
    }
    default: throw new Error("E_ARRIVAL");
  }
}

// 카메라 평균 간격과 간격 변동계수 제곱 (분석식 · 근사에 씀)
export function arrivalStats(cam, log) {
  const I = 1000 / cam.fps;
  switch (cam.mode) {
    case "fixed": return { mean: I, cv2: 0 };
    case "jitter": { const sd = Math.min(+cam.jitterMs || 0, 0.45 * I); return { mean: I, cv2: (2 * sd * sd) / (I * I) }; }
    case "poisson": return { mean: I, cv2: 1 };
    case "burst": {
      const n = Math.max(1, Math.round(cam.burstN)), ib = 1000 / cam.burstFps, g = Math.max(0, +cam.gapMs || 0);
      const m = ib + g / n, v = ((n - 1) * (ib - m) ** 2 + (ib + g - m) ** 2) / n;
      return { mean: m, cv2: v / (m * m) };
    }
    case "log": {
      const a = log.arrivals, n = a.length;
      let s = 0, s2 = 0;
      for (let i = 1; i < n; i++) { const d = a[i] - a[i - 1]; s += d; s2 += d * d; }
      const m = s / (n - 1);
      return { mean: m, cv2: Math.max(0, s2 / (n - 1) - m * m) / (m * m) };
    }
  }
  return { mean: I, cv2: 0 };
}

// 처리 시간 분포의 평균 · 변동계수 제곱 · 분위수 (표본 2만 개, 같은 난수)
export function distStats(dist, seed, stream, log) {
  if (dist.type === "fixed") return { mean: +dist.mean, cv2: 0, p50: +dist.mean, p99: +dist.mean, max: +dist.mean };
  const f = sampler(dist, seed, stream, log);
  const n = dist.type === "log" ? Math.min(log.cols[dist.col].length, 200000) : 20000;
  const v = new Float64Array(n);
  let s = 0, s2 = 0;
  for (let k = 0; k < n; k++) { const x = dist.type === "log" ? log.cols[dist.col][k] : f(k); v[k] = x; s += x; s2 += x * x; }
  v.sort();
  const mean = dist.type === "exp" || dist.type === "normal" || dist.type === "lognormal" || dist.type === "gamma" ? +dist.mean : s / n;
  const cv2 = dist.type === "exp" ? 1 : dist.type === "log" ? Math.max(0, s2 / n - mean * mean) / (mean * mean) : ((+dist.sd || 0) / mean) ** 2;
  return { mean, cv2, p50: v[Math.floor(n * 0.5)], p99: v[Math.min(n - 1, Math.floor(n * 0.99))], max: v[n - 1] };
}

// ---------- 설정 검사 ----------
// 오류는 { path, code } 목록. 화면은 code 를 문자열로 바꿔 보여준다.
export function validate(cfg, log) {
  const err = [];
  const c = cfg.camera || {};
  const pos = (v) => Number.isFinite(+v) && +v > 0;
  if (!ARRIVALS.includes(c.mode)) err.push({ path: "camera.mode", code: "E_ARRIVAL" });
  if (["fixed", "jitter", "poisson"].includes(c.mode) && !pos(c.fps)) err.push({ path: "camera.fps", code: "E_POS" });
  if (c.mode === "burst" && (!pos(c.burstN) || !pos(c.burstFps))) err.push({ path: "camera.burst", code: "E_POS" });
  if (c.mode === "log" && !(log?.arrivals?.length >= 2)) err.push({ path: "camera.mode", code: "E_LOG_TIME" });
  if (!pos(cfg.durationS) && !pos(cfg.frames)) err.push({ path: "durationS", code: "E_POS" });
  if (!(Number.isFinite(+cfg.frameMB) && +cfg.frameMB >= 0)) err.push({ path: "frameMB", code: "E_NONNEG" });
  if (!Array.isArray(cfg.stages) || !cfg.stages.length) err.push({ path: "stages", code: "E_NO_STAGE" });
  (cfg.stages || []).forEach((s, i) => {
    const p = `stages.${i}.`;
    if (!(Number.isInteger(+s.from) && +s.from >= -1 && +s.from < i)) err.push({ path: p + "from", code: "E_FROM" });
    if (!(Number.isInteger(+s.workers) && +s.workers >= 1 && +s.workers <= 256)) err.push({ path: p + "workers", code: "E_WORKERS" });
    if (!POLICIES.includes(s.policy)) err.push({ path: p + "policy", code: "E_POLICY" });
    if (["dropOld", "dropNew", "block"].includes(s.policy) && !(Number.isInteger(+s.cap) && +s.cap >= 1)) err.push({ path: p + "cap", code: "E_CAP" });
    const d = s.dist || {};
    if (!DISTS.includes(d.type)) err.push({ path: p + "dist", code: "E_DIST" });
    else if (d.type === "log") { if (!log?.cols?.[d.col]?.length) err.push({ path: p + "dist", code: "E_LOG_COL" }); }
    else {
      if (!pos(d.mean)) err.push({ path: p + "mean", code: "E_POS" });
      if (["normal", "lognormal", "gamma"].includes(d.type) && !(Number.isFinite(+d.sd) && +d.sd >= 0)) err.push({ path: p + "sd", code: "E_NONNEG" });
    }
  });
  return err;
}

// ---------- 자료 구조 ----------
class Deque {
  constructor() { this.f = new Array(16); this.t = new Float64Array(16); this.h = 0; this.n = 0; this.m = 15; this.lt = 0; }
  push(f, t) {
    if (this.n > this.m) this.grow();
    const i = (this.h + this.n) & this.m;
    this.f[i] = f; this.t[i] = t; this.n++;
  }
  shift() {
    const i = this.h, f = this.f[i];
    this.f[i] = undefined; this.lt = this.t[i];
    this.h = (i + 1) & this.m; this.n--;
    return f;
  }
  grow() {
    const cap = (this.m + 1) * 2, f = new Array(cap), t = new Float64Array(cap);
    for (let j = 0; j < this.n; j++) { const i = (this.h + j) & this.m; f[j] = this.f[i]; t[j] = this.t[i]; }
    this.f = f; this.t = t; this.h = 0; this.m = cap - 1;
  }
}

class Heap { // (시각, 우선순위, 순번) 최소 힙. 같은 시각이면 처리 완료가 도착보다 먼저
  constructor() { this.t = new Float64Array(64); this.k = new Float64Array(64); this.p = new Int32Array(64); this.n = 0; this.seq = 0; }
  push(t, pri, p) {
    if (this.n === this.t.length) {
      const g = (a, C) => { const b = new C(a.length * 2); b.set(a); return b; };
      this.t = g(this.t, Float64Array); this.k = g(this.k, Float64Array); this.p = g(this.p, Int32Array);
    }
    let i = this.n++;
    const key = pri * 1e15 + this.seq++;
    const T = this.t, K = this.k, P = this.p;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (T[j] < t || (T[j] === t && K[j] < key)) break;
      T[i] = T[j]; K[i] = K[j]; P[i] = P[j]; i = j;
    }
    T[i] = t; K[i] = key; P[i] = p;
  }
  pop() { // 맨 앞 항목의 payload. 시각은 this.top
    const T = this.t, K = this.k, P = this.p;
    const out = P[0]; this.top = T[0];
    const n = --this.n;
    if (n > 0) {
      const t = T[n], key = K[n], p = P[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && (T[c + 1] < T[c] || (T[c + 1] === T[c] && K[c + 1] < K[c]))) c++;
        if (T[c] > t || (T[c] === t && K[c] > key)) break;
        T[i] = T[c]; K[i] = K[c]; P[i] = P[c]; i = c;
      }
      T[i] = t; K[i] = key; P[i] = p;
    }
    return out;
  }
}

class Grow32 { // 늘어나는 Float32Array
  constructor() { this.a = new Float32Array(1024); this.n = 0; }
  push(v) { if (this.n === this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; }
  done() { return this.a.subarray(0, this.n); }
}

// ---------- 시뮬레이션 ----------
// cfg: { seed, durationS | frames, camera, frameMB, baseMB, limitMB, stages: [{ name, from, workers, cap, policy, keep, dist }] }
// frames 를 주면 그 수만큼 도착시키고 모두 끝날 때까지 돌린다 (분석식 대조용). durationS 는 그 시각에 멈춘다.
// opt: { buckets, keepLatency, onProgress }
export function simulate(cfg, log, opt = {}) {
  const errs = validate(cfg, log);
  if (errs.length) { const e = new Error(errs[0].code); e.errors = errs; throw e; }
  const seed = (cfg.seed >>> 0) || 1;
  const S = cfg.stages.length;
  const drain = +cfg.frames > 0;
  const nFrames = drain ? Math.min(MAX_FRAMES, Math.floor(+cfg.frames)) : MAX_FRAMES;
  const T = drain ? Infinity : +cfg.durationS * 1000;
  const arrive = arrivals(cfg.camera, seed, log);
  const frameMB = +cfg.frameMB || 0, baseMB = +cfg.baseMB || 0, limitMB = +cfg.limitMB > 0 ? +cfg.limitMB : Infinity;

  const kids = Array.from({ length: S + 1 }, () => []);
  const st = cfg.stages.map((s, i) => {
    kids[+s.from + 1].push(i);
    const cap = s.policy === "all" ? Infinity : s.policy === "latest" ? 1 : +s.cap;
    return {
      i, from: +s.from, workers: +s.workers, cap, policy: s.policy, viaCamera: +s.from === -1,
      svc: sampler(s.dist, seed, i + 1, log),
      q: new Deque(), waiters: new Deque(), busy: 0,
      offered: 0, started: 0, served: 0, dropped: 0, blockedN: 0, blockedNow: 0, waitSum: 0, latSum: 0, svcSum: 0, maxQ: 0,
      areaQ: 0, areaBusy: 0, lastT: 0, lat: opt.keepLatency === false ? null : new Grow32(), latMax: 0,
    };
  });

  // 시계열: 구간마다 대기열 최대 · 메모리 최대
  const NB = opt.buckets || 600;
  let bucketMs = drain ? 0 : T / NB;
  const serQ = st.map(() => new Float32Array(NB)), serMem = new Float32Array(NB);
  let curB = 0;

  let alive = 0, alivePeak = 0, alivePeakT = 0, limitT = null;
  const memOf = (a) => baseMB + a * frameMB;
  if (memOf(0) >= limitMB) limitT = 0;

  // 처리 중 슬롯: 완료 사건의 payload
  let slotF = [], slotS = new Int32Array(1024), slotStart = new Float64Array(1024), free = [], slotN = 0;
  const newSlot = () => {
    if (free.length) return free.pop();
    if (slotN === slotS.length) {
      const a = new Int32Array(slotN * 2); a.set(slotS); slotS = a;
      const b = new Float64Array(slotN * 2); b.set(slotStart); slotStart = b;
    }
    return slotN++;
  };

  const heap = new Heap(), k0 = kids[0];
  let now = 0, k = 0;

  const area = (s, t) => { s.areaQ += s.q.n * (t - s.lastT); s.areaBusy += s.busy * (t - s.lastT); s.lastT = t; };
  const markQ = (s) => { if (s.q.n > s.maxQ) s.maxQ = s.q.n; if (s.q.n > serQ[s.i][curB]) serQ[s.i][curB] = s.q.n; };
  const hold = (f) => {
    if (f.ref++ === 0) {
      alive++;
      if (alive > alivePeak) { alivePeak = alive; alivePeakT = now; }
      if (alive > serMem[curB]) serMem[curB] = alive;
      if (limitT === null && memOf(alive) >= limitMB) limitT = now;
    }
  };
  const release = (f) => { if (--f.ref === 0) alive--; };

  const start = (s, f, tEnq) => {
    s.busy++; s.started++;
    s.waitSum += now - tEnq;
    const d = s.svc(f.k);
    s.svcSum += d;
    const id = newSlot();
    slotF[id] = f; slotS[id] = s.i; slotStart[id] = now;
    heap.push(now + d, 0, id);
  };

  // 기다리던 프레임을 작업자에게, 막혀 있던 앞 단계 프레임을 대기열로
  const pump = (s) => {
    while (s.busy < s.workers && s.q.n > 0) {
      area(s, now);
      const f = s.q.shift();
      start(s, f, s.q.lt);
      if (s.waiters.n > 0) admitWaiter(s);
    }
  };
  const admitWaiter = (s) => {
    const w = s.waiters.shift();
    s.q.push(w.f, now); // 막힌 동안 잡고 있던 몫을 그대로 넘긴다 (ref 변화 없음)
    markQ(s);
    if (--w.p.n === 0) { const u = st[w.p.s]; area(u, now); u.busy--; u.blockedNow--; pump(u); }
  };

  // 단계 s 에 프레임 f 를 넣는다. pend 가 있으면 앞 단계 작업자가 막혀 기다릴 수 있다
  const offer = (s, f, pend, src) => {
    s.offered++;
    if (s.busy < s.workers && s.q.n === 0) { area(s, now); hold(f); start(s, f, now); return pend; }
    if (s.q.n < s.cap) { area(s, now); hold(f); s.q.push(f, now); markQ(s); return pend; }
    if (s.policy === "latest" || s.policy === "dropOld") {
      area(s, now);
      const old = s.q.shift();
      s.dropped++; release(old);
      hold(f); s.q.push(f, now); markQ(s);
      return pend;
    }
    if (s.policy === "block" && pend !== undefined) {
      const p = pend || { s: src, n: 0 };
      p.n++; s.blockedN++;
      hold(f); s.waiters.push({ f, p }, now);
      return p;
    }
    s.dropped++; // dropNew, 또는 카메라 바로 뒤의 막기 (카메라는 기다리지 않는다)
    return pend;
  };

  const progressEvery = 1 << 18;
  const nextArrival = () => {
    if (k >= nFrames) return;
    const t = arrive(k);
    if (t < T) heap.push(t, 1, -1);
  };
  nextArrival();

  while (heap.n > 0) {
    const p = heap.pop();
    now = heap.top;
    if (now >= T) { now = T; break; }
    if (bucketMs) {
      const b = Math.min(NB - 1, Math.floor(now / bucketMs));
      if (b > curB) {
        for (let x = curB + 1; x <= b; x++) { for (const s of st) serQ[s.i][x] = s.q.n; serMem[x] = alive; }
        curB = b;
      }
    }
    if (p < 0) { // 도착
      const f = { k, t0: now, ref: 0 };
      k++;
      for (let j = 0; j < k0.length; j++) offer(st[k0[j]], f, undefined);
      if ((k & (progressEvery - 1)) === 0 && opt.onProgress) opt.onProgress(drain ? k / nFrames : now / T);
      nextArrival();
    } else { // 처리 완료
      const f = slotF[p], s = st[slotS[p]];
      slotF[p] = undefined; free.push(p);
      s.served++;
      const lat = now - f.t0;
      s.latSum += lat;
      if (lat > s.latMax) s.latMax = lat;
      if (s.lat) s.lat.push(lat);
      let pend = null;
      const kc = kids[s.i + 1];
      for (let j = 0; j < kc.length; j++) pend = offer(st[kc[j]], f, pend, s.i);
      release(f);
      if (pend && pend.n > 0) s.blockedNow++; // 막혔으면 작업자는 프레임을 쥐고 기다린다
      else { area(s, now); s.busy--; pump(s); }
    }
  }
  const end = drain ? now : T;
  for (const s of st) area(s, end);
  if (drain) { bucketMs = 0; }

  const stages = st.map((s, i) => {
    const lat = s.lat ? s.lat.done() : null;
    const [p50, p95, p99] = lat && lat.length ? quantiles(lat, [0.5, 0.95, 0.99]) : [null, null, null];
    return {
      name: cfg.stages[i].name, keep: !!cfg.stages[i].keep, policy: s.policy, workers: s.workers,
      offered: s.offered, served: s.served, dropped: s.dropped, blocked: s.blockedN,
      remaining: s.q.n + s.busy - s.blockedNow + s.waiters.n, waitingEnd: s.q.n,
      started: s.started, waitMean: s.started ? s.waitSum / s.started : 0, svcMean: s.started ? s.svcSum / s.started : 0,
      latMean: s.served ? s.latSum / s.served : null,
      p50, p95, p99, max: s.served ? s.latMax : null,
      maxQ: s.maxQ, avgQ: end > 0 ? s.areaQ / end : 0, util: end > 0 ? s.areaBusy / (s.workers * end) : 0,
      lat,
    };
  });
  return {
    endMs: end, frames: k, stages,
    alivePeak, alivePeakMs: alivePeakT, aliveEnd: alive,
    memPeakMB: memOf(alivePeak), memEndMB: memOf(alive), limitMB: Number.isFinite(limitMB) ? limitMB : null, limitHitMs: limitT,
    series: drain ? null : { bucketMs: T / NB, q: serQ, mem: serMem.map(memOf) },
  };
}

// 분위수: 정렬 대신 quickselect (큰 분위수부터, 배열 순서를 바꾼다). 값은 a[floor(p·n)]
export function quantiles(a, ps) {
  const n = a.length, out = new Array(ps.length);
  const order = ps.map((p, i) => [Math.min(n - 1, Math.floor(p * n)), i]).sort((x, y) => y[0] - x[0]);
  let hi = n - 1;
  for (const [idx, i] of order) { select(a, 0, hi, idx); out[i] = a[idx]; hi = idx; }
  return out;
}
function select(a, l, r, k) { // Hoare 분할, 가운데 셋 중앙값
  while (r > l) {
    const m = (l + r) >> 1;
    if (a[m] < a[l]) swap(a, m, l);
    if (a[r] < a[l]) swap(a, r, l);
    if (a[r] < a[m]) swap(a, r, m);
    const piv = a[m];
    let i = l, j = r;
    while (i <= j) {
      while (a[i] < piv) i++;
      while (a[j] > piv) j--;
      if (i <= j) { swap(a, i, j); i++; j--; }
    }
    if (k <= j) r = j; else if (k >= i) l = i; else return;
  }
}
function swap(a, i, j) { const t = a[i]; a[i] = a[j]; a[j] = t; }

// 모든 정책을 '전부 처리'로 바꾼 같은 도착열: 손실 0 에 필요한 큐 크기 = 그때의 최대 대기 수
export function unboundedTwin(cfg) {
  return { ...cfg, stages: cfg.stages.map((s) => ({ ...s, policy: "all" })) };
}

// 메모리 한도 도달 시각: 기간 안이면 시뮬 값, 아니면 끝 절반 구간의 기울기로 외삽 (끝없이 쌓이는 단계가 있을 때만)
export function memoryForecast(res, rho) {
  if (res.limitMB === null) return { kind: "nolimit" };
  if (res.limitHitMs !== null) return { kind: "sim", ms: res.limitHitMs };
  const grows = rho.some((r) => r.unbounded && r.rho >= 1);
  const m = res.series?.mem;
  if (!grows || !m) return { kind: "stable", peakMB: res.memPeakMB };
  const n = m.length, a = Math.floor(n / 2), dt = res.series.bucketMs;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, c = 0;
  for (let i = a; i < n; i++) { const x = (i + 0.5) * dt; sx += x; sy += m[i]; sxx += x * x; sxy += x * m[i]; c++; }
  const slope = (c * sxy - sx * sy) / (c * sxx - sx * sx); // MB / ms
  if (!(slope > 0)) return { kind: "stable", peakMB: res.memPeakMB };
  const yEnd = sy / c + slope * (res.endMs - sx / c);
  return { kind: "extrap", ms: res.endMs + Math.max(0, (res.limitMB - yEnd) / slope), mbPerHour: slope * 3.6e6 };
}

// 단계별 부하 ρ = 들어온 비율 × 평균 처리 시간 / 작업자 수 (시뮬 결과 기준)
export function loads(cfg, res) {
  return res.stages.map((s, i) => ({
    rho: res.endMs > 0 ? (s.offered / res.endMs) * s.svcMean / s.workers : 0,
    unbounded: cfg.stages[i].policy === "all",
  }));
}
