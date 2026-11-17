import { mkdir, writeFile } from 'node:fs/promises';
import { researchCaba, researchMarkdown } from '../sources/openai-caba-research.js';

const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--live')) throw new Error('Usar npm run research:caba -- --live');
const report = await researchCaba({ apiKey: process.env.OPENAI_API_KEY, allowLive: args.includes('--live'),
  days: Number(process.env.RESEARCH_DAYS || 7), creditsExpireAt: process.env.OPENAI_CREDITS_EXPIRE_AT });
await mkdir('tmp', { recursive: true });
// Each run keeps its own result, including empty searches and failures.
const filename = `tmp/caba-research-${report.fetchedAt.replace(/[:.]/g, '-')}`;
await writeFile(`${filename}.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
await writeFile(`${filename}.md`, researchMarkdown(report), { flag: 'wx' });
console.log(JSON.stringify({ status: report.status, code: report.code, leads: report.editorialLeads.length,
  usage: report.usage, report: `${filename}.md` }));
if (!report.ok) process.exitCode = 2;
