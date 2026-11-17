import { mkdir, writeFile } from 'node:fs/promises';
import { captureX } from '../sources/openai-x-discovery.js';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--live')) throw new Error('Usar npm run capture:x -- --live para una captura con consumo de API.');
const report = await captureX({ apiKey: process.env.OPENAI_API_KEY, allowLive: args.includes('--live'),
  span: process.env.CAPTURE_SPAN || '1d', topic: process.env.X_TOPIC || 'all' });
await mkdir('tmp', { recursive: true });
await writeFile('tmp/x-openai-report.json', JSON.stringify(report, null, 2) + '\n');
const escape = text => String(text).replace(/[\r\n]+/g, ' ').replace(/[\\`*_[\]<>#|]/g, '\\$&');
const lines = ['# StonedOwl: pistas de X', '', `Consulta: ${report.fetchedAt}`, `Estado: ${report.status}`, '',
  'Cobertura parcial de publicaciones públicas indexadas. Los resúmenes requieren lectura del post original.', ''];
for (const lead of report.editorialLeads) {
  lines.push(`- [Abrir publicación](${lead.url}) · ${lead.publicationDate}`, `  ${escape(lead.modelSummary)}`,
    `  Temas: ${lead.topics.join(', ')}. Ubicación propuesta: ${escape(lead.proposedLocation.barrios.join(', ') || lead.proposedLocation.scope)}.`, '');
}
if (!report.editorialLeads.length) lines.push('Sin pistas utilizables en esta captura. No acredita ausencia de problemas.', '');
if (report.code) lines.push(`Detalle: ${report.code}`, '');
lines.push(...report.limitations.map(text => `- ${text}`));
await writeFile('tmp/x-openai-report.md', lines.join('\n') + '\n');
console.log(JSON.stringify({ status: report.status, code: report.code, leads: report.editorialLeads.length,
  usage: report.usage, report: 'tmp/x-openai-report.md' }));
if (!report.ok) process.exitCode = 2;
