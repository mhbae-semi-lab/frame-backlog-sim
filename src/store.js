// IndexedDB 저장소. 스키마 버전 1
//   kv: 화면 상태 · 작업 데이터 · 초안 설정 · 기준   workloads: 재현 세트(내가 저장한 작업 데이터)
//   history: 장비 설정 버전   shadow: Shadow 기록   logs: 읽어 둔 타이밍 로그(숫자 배열)   errors: 오류 기록
// IndexedDB 를 못 쓰는 환경(사생활 보호 창 등)에서는 메모리로 대신하고, 새로고침하면 사라진다.
const DB = "frame-backlog-sim", VER = 1;
const STORES = { kv: {}, workloads: { keyPath: "id" }, history: { keyPath: "v" }, shadow: { autoIncrement: true }, logs: { keyPath: "id" }, errors: { autoIncrement: true } };

let dbp = null;
const mem = Object.fromEntries(Object.keys(STORES).map((k) => [k, new Map()]));
let memSeq = 0;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    let req;
    try { req = indexedDB.open(DB, VER); } catch { res(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, o] of Object.entries(STORES)) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, o);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
    req.onblocked = () => res(null);
  });
  return dbp;
}

const wrap = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function tx(store, mode, fn) {
  const db = await open();
  if (!db) return fn(null);
  return fn(db.transaction(store, mode).objectStore(store));
}

export const get = (store, key) => tx(store, "readonly", (s) => (s ? wrap(s.get(key)) : mem[store].get(key)));
export const put = (store, value, key) => tx(store, "readwrite", (s) => {
  if (s) return wrap(key === undefined ? s.put(value) : s.put(value, key));
  const k = key ?? value?.[STORES[store].keyPath] ?? ++memSeq;
  mem[store].set(k, value);
  return k;
});
export const del = (store, key) => tx(store, "readwrite", (s) => (s ? wrap(s.delete(key)) : mem[store].delete(key)));
export const all = (store) => tx(store, "readonly", (s) => (s ? wrap(s.getAll()) : [...mem[store].values()]));
export const keys = (store) => tx(store, "readonly", (s) => (s ? wrap(s.getAllKeys()) : [...mem[store].keys()]));
export const clear = (store) => tx(store, "readwrite", (s) => (s ? wrap(s.clear()) : mem[store].clear()));
export const clearAll = async () => { for (const s of Object.keys(STORES)) await clear(s); };
export const persistent = async () => !!(await open());

// 오류 기록은 최근 200건만 둔다
export async function logError(e) {
  try {
    await put("errors", { t: new Date().toISOString(), msg: String(e?.message || e).slice(0, 500), stack: String(e?.stack || "").slice(0, 1500) });
    const list = await keys("errors");
    for (const k of list.slice(0, Math.max(0, list.length - 200))) await del("errors", k);
  } catch { /* 기록 실패는 무시 */ }
}

// 백업: 로그 숫자 배열까지 포함 (typed array 는 일반 배열로)
const plainLog = (l) => ({ ...l, arrivals: l.arrivals ? Array.from(l.arrivals) : null, cols: l.cols.map((c) => Array.from(c)) });
export async function exportBackup() {
  const kv = {};
  for (const k of await keys("kv")) kv[k] = await get("kv", k);
  return {
    app: "frame-backlog-sim", schema: VER, exported: new Date().toISOString(), kv,
    workloads: await all("workloads"), history: await all("history"), shadow: await all("shadow"), logs: (await all("logs")).map(plainLog),
  };
}
export async function importBackup(b) {
  if (!b || b.app !== "frame-backlog-sim" || !b.kv) throw new Error("E_BACKUP");
  for (const [k, v] of Object.entries(b.kv)) await put("kv", v, k);
  for (const w of b.workloads || []) await put("workloads", w);
  await clear("history");
  for (const h of b.history || []) await put("history", h);
  await clear("shadow");
  for (const s of b.shadow || []) await put("shadow", s);
  for (const l of b.logs || []) await put("logs", { ...l, arrivals: l.arrivals ? Float64Array.from(l.arrivals) : null, cols: l.cols.map((c) => Float64Array.from(c)) });
}
