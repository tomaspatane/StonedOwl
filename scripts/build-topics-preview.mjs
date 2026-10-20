import { readFile, writeFile, mkdir } from 'node:fs/promises';
const [reportText, html, css, js] = await Promise.all([
  readFile('tmp/live-topics-report.json', 'utf8'), readFile('public/index.html', 'utf8'),
  readFile('public/style.css', 'utf8'), readFile('public/app.js', 'utf8')
]);
const report = JSON.parse(reportText);
if (!report.topics || !report.fetchedAt) throw new Error('Se necesita una captura real previa: npm run smoke:topics');
const data = JSON.stringify(report).replace(/</g, '\\u003c');
const shim = `const previewData = ${data};
window.fetch = async function(input) {
  const url = new URL(input, 'https://local-preview.invalid');
  const topic = url.pathname.replace('/api/', '');
  const source = previewData.topics[topic];
  if (!source) return { ok: false, json: async () => ({ error: 'La vista local incluye sólo los tres temas nuevos.' }) };
  const data = structuredClone(source);
  const span = url.searchParams.get('span') || '1w';
  const windows = { '1d': 86400000, '3d': 259200000, '1w': 604800000 };
  data.editorialCases = data.editorialCases.filter(item => Date.parse(data.fetchedAt) - Date.parse(item.publicationDate) <= windows[span]);
  if (span !== source.span && data.snapshotComparison) data.snapshotComparison = { ...data.snapshotComparison, status: 'unknown', eligible: false, counts: null, changes: null, reasons: ['preview_window_filter'] };
  return { ok: true, json: async () => data };
};`;
const banner = `<div style="padding:14px 26px;background:#422006;color:#fef3c7;font:14px system-ui">Archivo local de la ampliación · captura ${report.fetchedAt} · datos congelados, no estado en vivo. Actualizar sólo reaplica esta captura; no consulta fuentes. Este archivo no forma parte del monitoreo horario. Electricidad no está incluida en este archivo de vista previa.</div>`;
const output = html.replace('<link rel="stylesheet" href="style.css">', `<style>${css}</style>`)
  .replace('<body>', `<body>${banner}`)
  .replace('<option value="transporte">', '<option value="transporte" selected>')
  .replace('<script src="app.js"></script>', `<script>${shim}</script><script>${js}</script>`);
await mkdir('tmp', { recursive: true });
await writeFile('tmp/stoned-owl-topics-preview.html', output);
console.log('Local snapshot preview written: tmp/stoned-owl-topics-preview.html');
