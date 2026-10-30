import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { compareSourceFrames, evidenceText, extractSourceFrame, runNarrativePilot } from "../data/narrative-pilot.js";

// Synthetic adversarial examples below are tests, never empirical evaluation data.
const source = (id, text, publicationDate = "2026-10-05") => ({ id, text, publicationDate });
const announced = source("announced", "Metrodelegados anunciaron un paro en la Línea A");
const ended = source("ended", "Levantaron el paro de la Línea A", "2026-10-06");
const a = extractSourceFrame(announced), b = extractSourceFrame(ended);
assert.equal(evidenceText(announced, a.fields.actor), "Metrodelegados");
assert.equal(evidenceText(announced, a.fields.place), "Línea A");
assert.equal(b.fields.actor, null, "no inventar sujeto omitido");
assert.equal(a.fields.eventTime, null, "publicación no es fecha del hecho");
assert.equal(compareSourceFrames(a, b).decision, "state_difference_review");
assert.equal(compareSourceFrames(a, extractSourceFrame(source("line-b", announced.text.replace("Línea A", "Línea B")))).decision, "different_scope_or_event");
assert.equal(compareSourceFrames(a, extractSourceFrame(source("later", announced.text, "2026-10-20"))).decision, "outside_publication_window");
for (const text of ["No anunciaron un paro en la Línea A", "Posible paro total de subtes y Premetro", "Paro total en CABA", "Línea A: anunciaron un paro y levantaron el paro", "Recordaron el paro del año pasado en la Línea A", "Línea A y Línea B: anunciaron un paro"]) {
  assert.equal(compareSourceFrames(a, extractSourceFrame(source("ambiguous", text))).decision, "needs_review");
}
assert.equal(compareSourceFrames(a, extractSourceFrame(source("unknown-date", announced.text, null))).decision, "needs_review");
assert.equal(compareSourceFrames(a, extractSourceFrame(source("invalid-date", announced.text, "2026-02-30"))).decision, "needs_review");
assert.equal(compareSourceFrames(a, extractSourceFrame(source("invalid-iso", announced.text, "2026-10-05Tinvalid"))).decision, "needs_review");
assert.equal(compareSourceFrames(extractSourceFrame(source("date1", `${announced.text} para 2026-11-01`)), extractSourceFrame(source("date2", `${announced.text} para 2026-11-08`))).decision, "different_event_date");
assert.equal(compareSourceFrames(a, extractSourceFrame(source("actor2", "Emova anunció un paro en la Línea A"))).decision, "actor_difference_review");
assert.throws(() => evidenceText(ended, a.fields.actor), /Invalid source/);
assert.throws(() => evidenceText(announced, { evidence: { sourceId: "announced", start: -1, end: 4 } }), /Invalid source/);
assert.throws(() => runNarrativePilot({ documents: [announced, announced] }), /Duplicate/);
assert.equal(extractSourceFrame(source("detention", "Paro total de subtes y Premetro por la detención de trabajadores")).fields.actor, null);

const fixture = JSON.parse(await fs.readFile(new URL("../docs/caba-narrative-pilot-v0.json", import.meta.url), "utf8"));
const report = runNarrativePilot(fixture);
assert.equal(report.pairCount, 45);
assert.equal(report.episodeCount, 3);
assert.equal(report.productionReady, false);
assert.equal(report.recommendedMethod, null);
assert.equal(report.pairs.filter(pair => pair.expectedSameStage).length, 5);
assert.ok(report.pairs.every(pair => !pair.autoMerge && !pair.independentCorroboration));
assert.ok(report.frames.every(frame => frame.activeIncident === null && !frame.affectsThermometer));
for (const [index, frame] of report.frames.entries()) {
  for (const item of [...Object.values(frame.fields), ...frame.framing].filter(Boolean)) {
    assert.ok(evidenceText(fixture.documents[index], item).length);
  }
}
const unlabelled = runNarrativePilot({ documents: fixture.documents });
assert.equal(unlabelled.summary, null);
assert.equal(unlabelled.status, "unlabelled_review_only");
assert.deepEqual(unlabelled.frames, report.frames, "las etiquetas no alimentan la extracción");
const reordered = runNarrativePilot({ ...fixture, documents: [...fixture.documents].reverse() });
assert.deepEqual(reordered.summary, report.summary, "no depender del orden de captura");
const polluted = runNarrativePilot({ ...fixture, documents: fixture.documents.map(doc => ({ ...doc, summary: "secreto gold", episode: "inyectado" })) });
assert.deepEqual(polluted.frames, report.frames, "ignorar contexto gold compartido");
assert.deepEqual(polluted.pairs, report.pairs);
const reannotated = runNarrativePilot({ ...fixture, labels: Object.fromEntries(fixture.documents.map(doc => [doc.id, { episode: doc.id, stage: "changed" }])) });
assert.deepEqual(reannotated.pairs.map(({ expectedSameStage, ...pair }) => pair), report.pairs.map(({ expectedSameStage, ...pair }) => pair), "el gold sólo afecta evaluación, no decisiones");
assert.throws(() => runNarrativePilot({ documents: fixture.documents, labels: {} }), /needs separate/);
console.log("narrative pilot tests passed");
