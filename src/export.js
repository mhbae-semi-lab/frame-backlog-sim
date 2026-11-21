// 내보내기: JSON (설정 · 결과 전체), CSV (단계 요약 + 시계열), HTML 보고서 (표 + 차트 그림, 파일 하나)
export function download(name, text, type = "text/plain") {
  const blob = text instanceof Blob ? text : new Blob([text], { type: type + ";charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function toCSV(head, rows, series) {
  const out = [head.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  if (series) {
    out.push("", series.head.map(csvCell).join(","));
    for (const r of series.rows) out.push(r.map(csvCell).join(","));
  }
  return "﻿" + out.join("\n") + "\n";
}

// sections: [{ title, html }] — html 은 앱이 만든 표 (이미 이스케이프됨)
export function toHTML({ title, meta, sections, images, lang }) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{font:14px/1.6 system-ui,"Malgun Gothic",sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#1f1f1f}h1{font-size:20px}h2{font-size:16px;margin-top:28px}
table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{border:1px solid #d4d4d4;padding:4px 6px;text-align:right}th:first-child,td:first-child{text-align:left}th{background:#f0f0f0}
.bad{color:#b00000;font-weight:700}.ok{color:#1b6e20;font-weight:700}img{max-width:100%;border:1px solid #d4d4d4;margin:6px 0}.meta{color:#5e5e5e}</style></head><body>
<h1>${esc(title)}</h1><p class="meta">${esc(meta)}</p>
${sections.map((s) => `<h2>${esc(s.title)}</h2>${s.html}`).join("\n")}
${images.map((i) => `<h2>${esc(i.title)}</h2><img alt="${esc(i.title)}" src="${i.src}">`).join("\n")}
</body></html>`;
}
