import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRetrievalBenchmark, sourceDocumentText } from "../data/retrieval-benchmark.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "docs/caba-retrieval-benchmark-v0.json");
const outputJsonPath = path.join(root, "tmp/retrieval-benchmark-report.json");
const outputMarkdownPath = path.join(root, "tmp/retrieval-benchmark-report.md");

const readJson = async filePath => JSON.parse(await fs.readFile(filePath, "utf8"));
const manifest = await readJson(manifestPath);
const gold = await readJson(path.join(root, manifest.goldSource));
const observedNegatives = await readJson(path.join(root, manifest.observedNegativeSource));

const documents = [];
const excludedDocuments = [];
const sourceIdsByIncident = new Map();
gold.cases.forEach((incident, incidentIndex) => {
  const incidentId = `case-${String(incidentIndex + 1).padStart(3, "0")}`;
  const documentIds = [];
  incident.sources.forEach((source, sourceIndex) => {
    const id = `${incidentId}-source-${String(sourceIndex + 1).padStart(2, "0")}`;
    const text = sourceDocumentText(source);
    if (!text) {
      excludedDocuments.push({ id, url: source.url, reason: "no_recorded_source_text" });
      return;
    }
    documentIds.push(id);
    documents.push({
      id,
      incidentId,
      relevant: true,
      provenance: "human_validated_case",
      url: source.url,
      text
    });
  });
  sourceIdsByIncident.set(incidentIndex, documentIds);
});

observedNegatives.cases.forEach((entry, index) => {
  documents.push({
    id: `observed-negative-${String(index + 1).padStart(2, "0")}`,
    incidentId: null,
    relevant: false,
    provenance: "observed_false_positive",
    url: entry.url,
    text: [entry.title, entry.snippet].filter(Boolean).join(". ")
  });
});

const queries = manifest.queries.map((query, index) => ({
  id: `query-${String(index + 1).padStart(3, "0")}`,
  incidentId: `case-${String(query.incidentIndex + 1).padStart(3, "0")}`,
  queryType: query.queryType,
  text: query.text,
  relevantDocumentIds: sourceIdsByIncident.get(query.incidentIndex) || []
}));

if (queries.some(query => query.relevantDocumentIds.length === 0)) {
  throw new Error("Todas las consultas deben apuntar a por lo menos un documento validado.");
}

const result = runRetrievalBenchmark({
  documents,
  queries,
  k: 10,
  targetIncidentCount: manifest.targetIncidentCount
});
const report = {
  benchmarkId: manifest.benchmarkId,
  ...result,
  limitations: manifest.limitations,
  excludedDocuments,
  documents: documents.map(({ text, ...document }) => document)
};

const percentage = value => `${(value * 100).toFixed(1)}%`;
const markdown = [
  "# Benchmark de recuperación CABA — v0",
  "",
  `**Estado:** ${report.status} — ${report.statusReason || "muestra suficiente para comparar"}`,
  "",
  `Muestra: ${report.verifiedIncidentCount}/${report.targetIncidentCount} incidentes verificados, ${report.documentCount} documentos, corte @${report.k}.`,
  "",
  "| Método | Hit rate @10 | Recall medio @10 | MRR |",
  "|---|---:|---:|---:|",
  ...Object.entries(report.summary).map(([name, metrics]) =>
    `| ${name} | ${percentage(metrics.hitRateAtK)} | ${percentage(metrics.meanRecallAtK)} | ${metrics.meanReciprocalRank.toFixed(3)} |`
  ),
  "",
  `Documentos relevantes perdidos por la fusión: ${report.fusionLossCount}.`,
  "",
  "## Resultado por consulta",
  "",
  "| Consulta | Tipo | BM25 relevantes @10 | Vector relevantes @10 | Híbrido relevantes @10 | Perdidos al fusionar |",
  "|---|---|---:|---:|---:|---:|",
  ...report.perQuery.map(result => `| ${[
    result.id,
    result.queryType,
    result.metrics.bm25.relevantInTop.length,
    result.metrics.vector_tfidf_cosine.relevantInTop.length,
    result.metrics.hybrid_rrf.relevantInTop.length,
    result.lostByFusion.length
  ].join(" | ")} |`),
  "",
  "La recomendación por tipo de consulta queda bloqueada hasta completar la muestra; el JSON conserva métricas y rankings para hacerla automáticamente después.",
  "",
  "## Límites",
  "",
  ...report.limitations.map(limit => `- ${limit}`),
  "",
  "No se elige un método ganador mientras el estado sea `insufficient_sample`."
].join("\n");

await fs.mkdir(path.dirname(outputJsonPath), { recursive: true });
await fs.writeFile(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(outputMarkdownPath, `${markdown}\n`);
console.log(markdown);
console.log(`\nJSON: ${path.relative(root, outputJsonPath)}`);
console.log(`Markdown: ${path.relative(root, outputMarkdownPath)}`);
