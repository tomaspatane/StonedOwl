import assert from "node:assert/strict";
import {
  fuseRankings,
  rankBm25,
  rankTfidfCosine,
  runRetrievalBenchmark,
  sourceDocumentText,
  tokenize
} from "../data/retrieval-benchmark.js";

const documents = [
  { id: "subte", text: "Paro total de subtes y Premetro por medida gremial en CABA" },
  { id: "basura", text: "Incendio de un contenedor en San Cristóbal sobre Carlos Calvo" },
  { id: "ruido", text: "Venta de repuestos con envío en Caballito" }
];

assert.equal(rankBm25("paro subte", documents)[0].id, "subte");
assert.equal(rankTfidfCosine("contenedor San Cristóbal", documents)[0].id, "basura");
assert.notDeepEqual(tokenize("Línea A"), tokenize("Línea B"), "preservar identificadores de una letra");
assert.equal(sourceDocumentText({ title: "Texto propio", description: "resumen del analista", summary: "gold", place: "gold" }), "Texto propio");
assert.equal(sourceDocumentText({ description: "paráfrasis sin captura textual" }), "");

const fused = fuseRankings([
  [{ id: "a", score: 2 }, { id: "b", score: 1 }],
  [{ id: "b", score: 2 }, { id: "a", score: 1 }]
]);
assert.deepEqual(fused.map(entry => entry.id), ["a", "b"], "los empates deben ser deterministas");

const report = runRetrievalBenchmark({
  documents,
  queries: [{
    id: "q1",
    incidentId: "incident-1",
    queryType: "hecho",
    text: "paro subte",
    relevantDocumentIds: ["subte"]
  }],
  k: 2,
  targetIncidentCount: 30
});
assert.equal(report.status, "insufficient_sample");
assert.equal(report.verifiedIncidentCount, 1);
assert.equal(report.summary.bm25.hitRateAtK, 1);
assert.equal(report.summary.hybrid_rrf.hitRateAtK, 1);
assert.equal(report.fusionLossCount, 0);
assert.equal(report.byQueryType.hecho.recommendedMethod, null);
assert.equal(report.byQueryType.hecho.recommendationStatus, "blocked_insufficient_sample");

console.log("retrieval benchmark tests passed");
