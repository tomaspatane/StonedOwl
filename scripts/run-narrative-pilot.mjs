import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNarrativePilot } from "../data/narrative-pilot.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length > 1) throw new Error("Usage: npm run benchmark:narratives -- [input.json]");
const inputPath = args[0] ? path.resolve(args[0]) : path.join(root, "docs/caba-narrative-pilot-v0.json");
const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
const report = runNarrativePilot(input);
report.input = path.relative(root, inputPath);
report.limitations = input.limitations || [];
const output = path.join(root, "tmp/narrative-pilot-report.json");
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  status: report.status, documents: report.documentCount, episodes: report.episodeCount,
  pairs: report.pairCount, summary: report.summary, reviewPairs: report.reviewPairCount,
  productionReady: false, output: path.relative(root, output)
}, null, 2));
