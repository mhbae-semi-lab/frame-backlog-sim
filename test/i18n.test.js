import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _strings as S } from "../src/i18n.js";
import { POLICIES, DISTS } from "../src/engine.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("한국어 · 영어 키가 같다", () => {
  assert.deepEqual(Object.keys(S.ko).sort(), Object.keys(S.en).sort());
});

test("화면에서 쓰는 키가 모두 있다", () => {
  const app = read("../src/app.js"), html = read("../index.html");
  const used = new Set([...app.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/data-i18n(?:-html)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const p of m[1].split(";")) used.add(p.split(":")[1]);
  for (const m of app.matchAll(/"(th[A-Z][A-Za-z]+)"/g)) used.add(m[1]);
  // 이름을 이어 붙여 쓰는 키
  for (const p of POLICIES) used.add("pol_" + p);
  for (const d of DISTS) used.add("dist_" + d);
  for (const c of ["E_POS", "E_NONNEG", "E_ARRIVAL", "E_LOG_TIME", "E_NO_STAGE", "E_FROM", "E_WORKERS", "E_POLICY", "E_CAP", "E_DIST", "E_LOG_COL", "E_EMPTY", "E_COL", "E_NO_COLS", "E_NO_ROWS", "E_LOG_MISSING", "E_CANCELED", "E_WORKER", "E_BACKUP", "E_SETTINGS"]) used.add("err_" + c);
  for (const c of ["B_COLS", "B_TIME", "B_BACK", "B_NUM", "B_NEG"]) used.add("bad_" + c);
  for (const c of ["P_GROW", "P_LOSS_KEEP", "P_DROP_OK", "P_P99", "P_KEEP_DROP", "P_CAM_BLOCK", "P_BURST"]) used.add("pre_" + c);
  for (const c of ["keepLoss", "memory", "p99", "pass"]) used.add("crit_" + c);
  for (const c of ["first", "switch", "rollback"]) used.add("kind_" + c);
  for (const c of ["same", "few", "fail"]) used.add("sw_" + c);
  for (const c of ["auto", "light", "dark"]) used.add("theme_" + c);
  for (const c of ["scSlowDraw", "scBurst", "scMemCreep", "stage_proc", "stage_draw", "stage_save"]) used.add(c);
  const missing = [...used].filter((k) => !k.endsWith("_") && k !== "th" && !(k in S.ko)); // "pol_" · "th" + … 처럼 이어 붙이는 앞부분은 뺀다
  assert.deepEqual(missing, []);
});

test("엔진 · 모델의 코드가 문자열 목록에 모두 들어 있다", () => {
  const src = read("../src/engine.js") + read("../src/model.js") + read("../src/timing.js");
  for (const m of src.matchAll(/code: "([A-Z]_[A-Z_0-9]+)"/g)) assert.ok(("err_" + m[1]) in S.ko || ("pre_" + m[1]) in S.ko, m[1]);
  for (const m of src.matchAll(/fail\(li \+ 1, "([A-Z_]+)"/g)) assert.ok(("bad_" + m[1]) in S.ko, m[1]);
});
