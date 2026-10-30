const DEFAULT_K = 10;
const RRF_K = 60;

// Keep case labels, shared summaries and analyst descriptions out of the index.
// visible_status is a recorded source observation; description may be a paraphrase.
export function sourceDocumentText(source) {
  return [source.title, source.visible_status].filter(Boolean).join(". ");
}

const STOPWORDS = new Set([
  "a", "al", "ante", "bajo", "con", "contra", "de", "del", "desde", "dos", "el", "en",
  "entre", "es", "esta", "este", "la", "las", "lo", "los", "para", "por", "que", "se",
  "sin", "su", "sus", "tras", "un", "una", "y"
]);

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenize(value) {
  const normalized = normalizeText(value)
    .replace(/\blinea ([abcdeh])\b/g, "linea linea_$1");
  return normalized
    .split(/\s+/)
    .filter(token => token.length > 1 && !STOPWORDS.has(token));
}

function termCounts(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}

function corpusStats(documents) {
  const tokenized = documents.map(document => tokenize(document.text));
  const documentFrequency = new Map();
  for (const tokens of tokenized) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }
  const averageLength = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / Math.max(1, documents.length);
  return { tokenized, documentFrequency, averageLength };
}

function stableRanking(scoredDocuments) {
  return scoredDocuments.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

export function rankBm25(query, documents, options = {}) {
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  const queryTokens = tokenize(query);
  const { tokenized, documentFrequency, averageLength } = corpusStats(documents);
  const documentCount = documents.length;

  return stableRanking(documents.map((document, index) => {
    const tokens = tokenized[index];
    const counts = termCounts(tokens);
    let score = 0;
    for (const token of queryTokens) {
      const frequency = counts.get(token) || 0;
      if (!frequency) continue;
      const docsWithTerm = documentFrequency.get(token) || 0;
      const inverseDocumentFrequency = Math.log(1 + ((documentCount - docsWithTerm + 0.5) / (docsWithTerm + 0.5)));
      const normalization = frequency + k1 * (1 - b + b * (tokens.length / Math.max(1, averageLength)));
      score += inverseDocumentFrequency * ((frequency * (k1 + 1)) / normalization);
    }
    return { id: document.id, score };
  }));
}

export function rankTfidfCosine(query, documents) {
  const queryCounts = termCounts(tokenize(query));
  const { tokenized, documentFrequency } = corpusStats(documents);
  const documentCount = documents.length;
  const idf = token => Math.log((documentCount + 1) / ((documentFrequency.get(token) || 0) + 1)) + 1;
  const queryWeights = new Map([...queryCounts].map(([token, frequency]) => [token, frequency * idf(token)]));
  const queryNorm = Math.sqrt([...queryWeights.values()].reduce((sum, value) => sum + value ** 2, 0));

  return stableRanking(documents.map((document, index) => {
    const counts = termCounts(tokenized[index]);
    let dot = 0;
    let documentNormSquared = 0;
    for (const [token, frequency] of counts) {
      const weight = frequency * idf(token);
      documentNormSquared += weight ** 2;
      dot += weight * (queryWeights.get(token) || 0);
    }
    const denominator = queryNorm * Math.sqrt(documentNormSquared);
    return { id: document.id, score: denominator ? dot / denominator : 0 };
  }));
}

export function fuseRankings(rankings, options = {}) {
  const rrfK = options.rrfK ?? RRF_K;
  const scores = new Map();
  for (const ranking of rankings) {
    ranking.forEach((entry, index) => {
      scores.set(entry.id, (scores.get(entry.id) || 0) + (1 / (rrfK + index + 1)));
    });
  }
  return stableRanking([...scores].map(([id, score]) => ({ id, score })));
}

function evaluateRanking(ranking, relevantDocumentIds, k) {
  const relevant = new Set(relevantDocumentIds);
  const top = ranking.slice(0, k);
  const relevantInTop = top.filter(entry => relevant.has(entry.id)).map(entry => entry.id);
  const firstRelevantIndex = ranking.findIndex(entry => relevant.has(entry.id));
  return {
    hitAtK: relevantInTop.length > 0,
    recallAtK: relevant.size ? relevantInTop.length / relevant.size : 0,
    reciprocalRank: firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0,
    firstRelevantRank: firstRelevantIndex >= 0 ? firstRelevantIndex + 1 : null,
    relevantInTop
  };
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function runRetrievalBenchmark({ documents, queries, k = DEFAULT_K, targetIncidentCount = 30 }) {
  const methods = {
    bm25: query => rankBm25(query, documents),
    vector_tfidf_cosine: query => rankTfidfCosine(query, documents)
  };
  const perQuery = queries.map(query => {
    const rankings = Object.fromEntries(Object.entries(methods).map(([name, rank]) => [name, rank(query.text)]));
    rankings.hybrid_rrf = fuseRankings([rankings.bm25, rankings.vector_tfidf_cosine]);
    const metrics = Object.fromEntries(Object.entries(rankings).map(([name, ranking]) => [
      name,
      evaluateRanking(ranking, query.relevantDocumentIds, k)
    ]));
    const componentRelevant = new Set([
      ...metrics.bm25.relevantInTop,
      ...metrics.vector_tfidf_cosine.relevantInTop
    ]);
    const hybridRelevant = new Set(metrics.hybrid_rrf.relevantInTop);
    return {
      id: query.id,
      incidentId: query.incidentId,
      queryType: query.queryType,
      text: query.text,
      metrics,
      lostByFusion: [...componentRelevant].filter(id => !hybridRelevant.has(id)),
      topDocumentIds: Object.fromEntries(Object.entries(rankings).map(([name, ranking]) => [
        name,
        ranking.slice(0, k).map(entry => entry.id)
      ]))
    };
  });

  const methodNames = ["bm25", "vector_tfidf_cosine", "hybrid_rrf"];
  const summary = Object.fromEntries(methodNames.map(name => {
    const values = perQuery.map(result => result.metrics[name]);
    return [name, {
      hitRateAtK: average(values.map(value => Number(value.hitAtK))),
      meanRecallAtK: average(values.map(value => value.recallAtK)),
      meanReciprocalRank: average(values.map(value => value.reciprocalRank))
    }];
  }));
  const verifiedIncidentCount = new Set(queries.map(query => query.incidentId)).size;
  const enoughData = verifiedIncidentCount >= targetIncidentCount && documents.length >= targetIncidentCount;
  const queryTypes = [...new Set(perQuery.map(result => result.queryType))].sort();
  const byQueryType = Object.fromEntries(queryTypes.map(queryType => {
    const matches = perQuery.filter(result => result.queryType === queryType);
    const typeSummary = Object.fromEntries(methodNames.map(name => [name, {
      hitRateAtK: average(matches.map(result => Number(result.metrics[name].hitAtK))),
      meanRecallAtK: average(matches.map(result => result.metrics[name].recallAtK)),
      meanReciprocalRank: average(matches.map(result => result.metrics[name].reciprocalRank))
    }]));
    const orderedMethods = methodNames.slice().sort((left, right) =>
      typeSummary[right].meanRecallAtK - typeSummary[left].meanRecallAtK
      || typeSummary[right].meanReciprocalRank - typeSummary[left].meanReciprocalRank
      || left.localeCompare(right)
    );
    const first = typeSummary[orderedMethods[0]];
    const second = typeSummary[orderedMethods[1]];
    const tied = first.meanRecallAtK === second.meanRecallAtK
      && first.meanReciprocalRank === second.meanReciprocalRank;
    return [queryType, {
      queryCount: matches.length,
      summary: typeSummary,
      recommendedMethod: enoughData && !tied ? orderedMethods[0] : null,
      recommendationStatus: !enoughData ? "blocked_insufficient_sample" : tied ? "undecided_tie" : "selected"
    }];
  }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: enoughData ? "comparable" : "insufficient_sample",
    statusReason: enoughData
      ? null
      : `Se requieren ${targetIncidentCount} incidentes verificados; hay ${verifiedIncidentCount}.`,
    k,
    targetIncidentCount,
    verifiedIncidentCount,
    documentCount: documents.length,
    methods: {
      bm25: "BM25 léxico",
      vector_tfidf_cosine: "vector TF-IDF + coseno (baseline local; no es un modelo semántico)",
      hybrid_rrf: `fusión Reciprocal Rank Fusion (k=${RRF_K})`
    },
    summary,
    byQueryType,
    fusionLossCount: perQuery.reduce((sum, result) => sum + result.lostByFusion.length, 0),
    perQuery
  };
}
