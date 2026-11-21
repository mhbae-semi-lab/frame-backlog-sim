// 매뉴얼 · 보고서용 화면 캡처 (합성 데이터만). headless Chrome 을 DevTools 프로토콜로 움직인다.
//   1) python -m http.server 8748 --bind 127.0.0.1      (저장소 루트에서)
//   2) node docs/manual/capture.mjs [http://127.0.0.1:8748/]
// 결과: docs/manual/shots/*.png (1280 x 800, 배율 1.5) + marks.json (말풍선 자리, CSS px). Chrome 경로는 CHROME 환경 변수로 바꾼다.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const URL0 = process.argv[2] || "http://127.0.0.1:8748/";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "shots");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9341;
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "fbs-capture-"));
const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "--window-size=1280,800", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, seq = 0;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((x) => x.type === "page");
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch { /* 아직 시작 중 */ }
    await sleep(200);
  }
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
  });
}
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function js(expr) {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function view(w, h, scheme = "light", mobile = false) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1.5, mobile });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
}
// 요소를 화면 맨 위로 올리고 그 화면(뷰포트)을 찍는다. sel 이 없으면 현재 화면.
// marks: 말풍선 자리로 쓸 요소들 → shots/marks.json 에 CSS px 사각형 [x0, y0, x1, y1] (화면 밖이면 null)
const MARKS = {};
async function shot(name, sel, offset = 70, marks = []) {
  if (sel) await js(`const el = document.querySelector(${JSON.stringify(sel)}); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - ${offset});`);
  await js(`document.querySelector("#toast").hidden = true`);
  await sleep(350);
  MARKS[name] = await js(`return ${JSON.stringify(marks)}.map((m) => { const el = document.querySelector(m); if (!el) return null;
    const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight || !r.width) return null;
    return [r.left, r.top, r.right, Math.min(r.bottom, innerHeight)].map(Math.round); });`);
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, name + ".png"), Buffer.from(r.data, "base64"));
  console.log("shot", name, MARKS[name].map((x) => (x ? "o" : "-")).join(""));
}
const idle = () => js(`for (let i = 0; i < 600 && document.querySelector("#run").disabled && !document.querySelector("#cfg-err").textContent; i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 200));`);
async function load(lang = "ko") {
  await send("Page.navigate", { url: URL0 });
  await sleep(1500);
  await js(`await document.fonts.ready;
    if (document.querySelector("#onboard").open) document.querySelector("#onboard form button").click();
    const s = document.querySelector("#lang"); if (s.value !== "${lang}") { s.value = "${lang}"; s.dispatchEvent(new Event("change", { bubbles: true })); }`);
  await idle();
}
const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
const setCell = (row, key, v) => js(`const el = document.querySelector('#stage-body tr[data-i="${row}"] [data-k="${key}"]'); el.value = ${JSON.stringify(v)};
  el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));`);

try {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  // 깨끗한 상태로 시작
  await send("Page.navigate", { url: URL0 });
  await sleep(1200);
  await js(`for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase("frame-backlog-sim"); q.onsuccess = q.onerror = q.onblocked = r; });`);

  await view(1280, 800);
  await send("Page.navigate", { url: URL0 });
  await sleep(2500);
  await js(`await document.fonts.ready`);
  await shot("Onboard");
  await load("ko");
  await shot("Home", null, 70, ["#lang", "#theme", "#open-help", "#open-settings", "#scenario-btns", ".file-btn", "#open-sample-log", "#read-opts summary"]);

  // 그리기 느림 · 처음 설정(v1): 실패하는 결과
  await shot("Config", "#config", 66, ["#c-mode", "#m-limit", "#r-dur", ".stages th.g-data", ".stages th.g-set", '#stage-body tr[data-i="1"] [data-k="policy"]', '#stage-body tr[data-i="0"] [data-k="keep"]', "#add-stage", "#save-workload"]);
  await shot("Pre", "#stage-table", 66, ["#pre-notes li:nth-child(1)", "#pre-notes li:nth-child(2)", "#pre-notes li:nth-child(3)", "#run", "#draft-badge"]);
  await shot("Results", "#results", 66, ["#verdict .pass", "#verdict .card:nth-of-type(1)", "#verdict .card:nth-of-type(2)", "#verdict .card:nth-of-type(4)", "#res-table th:nth-child(2)", "#res-table th:nth-child(12)", "#export-row"]);
  await shot("Charts", ".charts", 60, ["#ch-q", "#ch-mem", "#ch-lat", "#lat-stage", '[data-table="mem"]']);

  // 메모리 누적 (v1): 8시간 시뮬 → 한도 도달 시각, 1시간만 돌리면 외삽
  await click('[data-sc="2"]'); await idle();
  await shot("MemCreep", "#results", 66, ["#verdict .card:nth-of-type(3)", "#ch-mem", "#res-table tbody tr:nth-child(3) td:nth-child(2)"]);
  await js(`const d = document.querySelector("#r-dur"); d.value = 60; d.dispatchEvent(new Event("input", { bubbles: true }));`);
  await click("#run"); await idle();
  await shot("MemCreepExtrap", "#results", 66, ["#verdict .card:nth-of-type(3)", "#ch-mem"]);
  await click('[data-sc="0"]'); await idle();

  // 초안: 그리기 최신만 · 처리 큐 64 · 저장 작업자 2
  await setCell(1, "policy", "latest");
  await setCell(0, "cap", 64);
  await setCell(2, "workers", 2);
  await click("#run"); await idle();
  await click("#vt-compare"); await sleep(300);
  await shot("Compare", "#verify", 66, ["#mode-badge", "#vp-compare .cmp-grid > div:first-child table", "#vp-compare .cmp-grid > div:last-child tbody tr:first-child td.chg", "#vp-compare .cmp-grid > div:last-child tbody tr:nth-child(3) td.chg", "#ch-cmp", "#discard-draft"]);
  await shot("ResultsFixed", "#results", 66, ["#verdict .pass", "#verdict .card:nth-of-type(2)", "#verdict .card:nth-of-type(3)"]);
  await shot("ChartsFixed", ".charts", 60, ["#ch-q", "#ch-mem"]);
  await click("#vt-repro"); await sleep(200);
  await click("#repro-run"); await idle();
  await click("#vt-repro"); await sleep(300);
  await shot("Repro", "#verify", 66, ["#vt-repro", "#repro-run", "#vp-repro tbody tr:nth-child(2) td:nth-child(3)", "#vp-repro tbody tr:nth-child(2) td:nth-child(4)", "[data-open]", "#wl-form"]);
  await click("#vt-shadow"); await sleep(300);
  await shot("Shadow", "#verify", 66, ["#crit-form", "#only-diff", "#vp-shadow tbody tr:first-child td:nth-child(3)", "#vp-shadow tbody tr:first-child td:nth-child(4)", "#vp-shadow tbody tr:first-child td:nth-child(5)"]);
  await click("#vt-switch"); await sleep(300);
  await js(`document.querySelector("#sw-note").value = "그리기 최신만 · 처리 큐 64 · 저장 작업자 2"`);
  await shot("SwitchReady", "#verify", 66, ["#vp-switch .sw-state b", "#sw-note", "#do-switch"]);
  await click("#do-switch"); await sleep(500);
  await shot("Switch", "#verify", 66, ["#mode-badge", "#vp-switch tbody tr:first-child", "[data-rollback]", "#exp-settings", "#vp-switch label.file-like"]);

  // 내 타이밍 로그: 예시 로그(합성)
  await js(`window.scrollTo(0, 0)`);
  await click("#open-sample-log"); await idle();
  await js(`document.querySelector("#bad").open = true;`);
  await shot("LogData", "#drop", 66, ["#log-info .stat:nth-child(3)", "#log-info .stat:nth-child(4)", "#log-info .stat:nth-child(5)", "#bad summary", "#fit-box table th:nth-child(9)", '[data-usefit="1"]']);
  await shot("BadLines", "#bad", 70, ["#bad summary", "#bad tbody tr:nth-child(1)", "#bad tbody tr:nth-child(2)", "#bad tbody tr:nth-child(3)", "#bad tbody tr:nth-child(4)"]);
  await js(`document.querySelector("#bad").open = false; document.querySelector("#read-opts").open = true;`);
  await shot("ReadOpts", "#drop", 66, ["#o-delim", "#o-enc", "#o-time", "#o-tunit", "#o-dunit", "#o-cols", "#reread"]);
  await js(`document.querySelector("#read-opts").open = false;`);
  await shot("LogConfig", "#stage-table", 66, ['#stage-body tr[data-i="0"] [data-k="dist"]', '#stage-body tr[data-i="0"] td.params', "#c-mode", "#run"]);

  await click("#open-help"); await sleep(400);
  await shot("Help");
  await js(`document.querySelector("#acc-run").scrollIntoView({ block: "start" }); document.querySelector("#acc-run").click();
    for (let i = 0; i < 300 && !document.querySelector("#acc-out table"); i++) await new Promise((r) => setTimeout(r, 200));
    document.querySelector("#acc-out").scrollIntoView({ block: "center" });`);
  await shot("Accuracy", null, 70, ["#acc-out table", "#acc-out tbody tr:nth-child(3) td:nth-child(5)", "#acc-out tbody tr:nth-child(9) td:nth-child(7)"]);
  await js(`document.querySelector("#help form button").click()`);
  await click("#open-settings"); await sleep(300);
  await shot("Settings", null, 70, ["#backup-export", "#backup-import", "#errors-export", "#reset-all"]);
  await js(`document.querySelector("#settings form button").click()`);

  await click('[data-sc="0"]'); await idle();
  await load("en");
  await shot("EnHome");
  await shot("EnResults", "#results", 66);

  await view(390, 844, "dark", true);
  await load("ko");
  await shot("MobileDark", "#results", 60);
  await view(1280, 800, "dark");
  await load("ko");
  await shot("DarkCharts", "#results", 66);
  writeFileSync(join(OUT, "marks.json"), JSON.stringify(MARKS, null, 1));
} finally {
  try { ws?.close(); } catch { /* */ }
  proc.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* 잠긴 파일은 남긴다 */ }
}
