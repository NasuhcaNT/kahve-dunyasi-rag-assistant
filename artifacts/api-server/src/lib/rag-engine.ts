import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

type RawChunk = {
  chunk_id: string;
  parent_source_id: string;
  source_url?: string;
  canonical_url?: string;
  title?: string;
  section_heading?: string;
  text?: string;
  search_text?: string;
  metadata?: {
    citation?: {
      title?: string;
      url?: string;
      section?: string;
    };
  };
};

export type KnowledgeChunk = {
  id: string;
  parentSourceId: string;
  title: string;
  url: string;
  section: string;
  text: string;
  searchText: string;
};

type IndexedChunk = KnowledgeChunk & {
  tokens: string[];
  termFrequencies: Map<string, number>;
  vectorNorm: number;
  sourceKey: string;
  sourcePosition: number;
};

export type RetrievedChunk = KnowledgeChunk & { score: number };

export type KnowledgeBase = {
  chunks: IndexedChunk[];
  documentCount: number;
  sourceCount: number;
  averageLength: number;
  documentFrequency: Map<string, number>;
  sourceChunkIndexes: Map<string, number[]>;
};

type RankedChunk = { index: number; score: number };

const RRF_K = 60;
const NEIGHBOR_RADIUS = 1;
const MAX_MERGED_TEXT_CHARS = 2300;
const MAX_DIRECT_CANDIDATES_MULTIPLIER = 5;

const STOP_WORDS = new Set([
  "acaba", "ama", "ancak", "artık", "asıl", "bana", "bazı", "belki",
  "ben", "bence", "beni", "benim", "beri", "beş", "bile", "bir",
  "biraz", "birçok", "birden", "biri", "birkaç", "birkez", "biz",
  "bize", "bizi", "bizim", "böyle", "böylece", "bu", "buna", "bunda",
  "bundan", "bunlar", "bunları", "bunların", "bunu", "bunun", "burada",
  "çok", "çünkü", "da", "daha", "dahi", "de", "defa", "diğer",
  "diye", "dolayı", "eğer", "en", "gibi", "hem", "hep", "hepsi",
  "her", "hiç", "hangi", "için", "ile", "ise", "işte", "kadar",
  "karşın", "kendi", "kendine", "kendini", "ki", "kim", "mı", "mi",
  "mu", "mü", "nasıl", "ne", "neden", "nerede", "nereye", "niçin",
  "o", "olan", "olarak", "oldu", "olduğu", "olmak", "olması", "oluyor",
  "on", "ona", "ondan", "onlar", "onlara", "onların", "onu", "onun",
  "orada", "öyle", "rağmen", "sana", "sanki", "şey", "şimdi", "şu",
  "şuna", "şunları", "şunu", "tarafından", "tüm", "ve", "veya", "ya",
  "yani", "yapılan", "yapılması", "yine", "yok", "üzere",
]);

function tokenize(value: string): string[] {
  const normalized = value
    .toLocaleLowerCase("tr-TR")
    .replace(/(\d+)\s*['’]?\s*(si|sı|ü|u)(?=$|[^\p{L}\p{N}])/gu, "$1$2");

  return (normalized.match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter(
    (token) => !STOP_WORDS.has(token),
  );
}

function termsApproximatelyMatch(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;

  const limit = Math.min(left.length, right.length);
  let prefixLength = 0;
  while (prefixLength < limit && left[prefixLength] === right[prefixLength]) {
    prefixLength += 1;
  }
  return prefixLength >= 4;
}

function queryTermImportance(term: string): number {
  if (term.startsWith("grup") || term.startsWith("grub")) return 1.8;
  if (term === "ait" || term.startsWith("bağlı") || term.startsWith("sahip")) {
    return 0.25;
  }
  return 1;
}

function normalizeSourceKey(chunk: KnowledgeChunk, fallbackIndex: number): string {
  if (chunk.url.trim()) return chunk.url.trim();
  if (chunk.parentSourceId.trim()) return chunk.parentSourceId.trim();
  return `source-${fallbackIndex}`;
}

function toKnowledgeChunk(raw: RawChunk): KnowledgeChunk {
  const citation = raw.metadata?.citation;
  const title = citation?.title || raw.title || "Kahve Dünyası";
  const url = citation?.url || raw.canonical_url || raw.source_url || "";
  const section = citation?.section || raw.section_heading || title;
  const text = raw.text || raw.search_text || "";
  const baseSearchText = raw.search_text || `${title}\n${section}\n${text}`;

  return {
    id: raw.chunk_id,
    parentSourceId: raw.parent_source_id,
    title,
    url,
    section,
    text,
    searchText: url ? `${baseSearchText}\n${url}` : baseSearchText,
  };
}

export async function loadKnowledgeBase(): Promise<KnowledgeBase> {
  const chunksPath = fileURLToPath(
    new URL("../data/kahve-dunyasi/clean_chunks.jsonl", import.meta.url),
  );
  const documentsPath = fileURLToPath(
    new URL("../data/kahve-dunyasi/clean_documents.jsonl", import.meta.url),
  );

  const [chunkText, documentText] = await Promise.all([
    readFile(chunksPath, "utf8"),
    readFile(documentsPath, "utf8"),
  ]);

  const rawChunks = chunkText
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RawChunk);

  if (rawChunks.length === 0) {
    throw new Error("Kahve Dünyası knowledge-base file contains no chunks.");
  }

  const baseChunks = rawChunks.map(toKnowledgeChunk);
  const sourceChunkIndexes = new Map<string, number[]>();
  const sourceKeys: string[] = [];
  const sourcePositions: number[] = [];

  baseChunks.forEach((chunk, index) => {
    const sourceKey = normalizeSourceKey(chunk, index);
    const indexes = sourceChunkIndexes.get(sourceKey) ?? [];
    sourceKeys[index] = sourceKey;
    sourcePositions[index] = indexes.length;
    indexes.push(index);
    sourceChunkIndexes.set(sourceKey, indexes);
  });

  const documentFrequency = new Map<string, number>();
  let tokenCount = 0;

  const tokenLists = baseChunks.map((chunk) => {
    const tokens = tokenize(chunk.searchText);
    tokenCount += tokens.length;
    for (const term of new Set(tokens)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
    return tokens;
  });

  const chunks: IndexedChunk[] = baseChunks.map((chunk, index) => {
    const tokens = tokenLists[index];
    const termFrequencies = new Map<string, number>();

    for (const term of tokens) {
      termFrequencies.set(term, (termFrequencies.get(term) ?? 0) + 1);
    }

    const vectorNorm = Math.sqrt(
      Array.from(termFrequencies, ([term, frequency]) => {
        const idf = inverseDocumentFrequency(
          rawChunks.length,
          documentFrequency.get(term) ?? 0,
        );
        const weight = (1 + Math.log(frequency)) * idf;
        return weight * weight;
      }).reduce((sum, value) => sum + value, 0),
    );

    return {
      ...chunk,
      tokens,
      termFrequencies,
      vectorNorm,
      sourceKey: sourceKeys[index],
      sourcePosition: sourcePositions[index],
    };
  });

  return {
    chunks,
    documentCount: documentText.split(/\r?\n/u).filter(Boolean).length,
    sourceCount: sourceChunkIndexes.size,
    averageLength: tokenCount / chunks.length || 1,
    documentFrequency,
    sourceChunkIndexes,
  };
}

function inverseDocumentFrequency(documentCount: number, frequency: number): number {
  return Math.log(1 + (documentCount - frequency + 0.5) / (frequency + 0.5));
}

function rankByBm25(
  queryTerms: string[],
  knowledgeBase: KnowledgeBase,
): RankedChunk[] {
  const k1 = 1.5;
  const b = 0.75;

  return knowledgeBase.chunks
    .map((chunk, index) => {
      let score = 0;

      for (const term of queryTerms) {
        const frequency = chunk.termFrequencies.get(term) ?? 0;
        if (frequency === 0) continue;

        const documentFrequency = knowledgeBase.documentFrequency.get(term) ?? 0;
        const idf = inverseDocumentFrequency(
          knowledgeBase.chunks.length,
          documentFrequency,
        );
        const lengthFactor =
          k1 * (1 - b + b * (chunk.tokens.length / knowledgeBase.averageLength));

        score += idf * ((frequency * (k1 + 1)) / (frequency + lengthFactor));
      }

      return { index, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
}

function rankByTfidf(
  queryTerms: string[],
  knowledgeBase: KnowledgeBase,
): RankedChunk[] {
  const queryFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    queryFrequency.set(term, (queryFrequency.get(term) ?? 0) + 1);
  }

  const queryWeights = new Map<string, number>();
  for (const [term, frequency] of queryFrequency) {
    const idf = inverseDocumentFrequency(
      knowledgeBase.chunks.length,
      knowledgeBase.documentFrequency.get(term) ?? 0,
    );
    queryWeights.set(term, (1 + Math.log(frequency)) * idf);
  }

  const queryNorm = Math.sqrt(
    Array.from(queryWeights.values()).reduce(
      (sum, weight) => sum + weight * weight,
      0,
    ),
  );

  return knowledgeBase.chunks
    .map((chunk, index) => {
      let dotProduct = 0;

      for (const [term, queryWeight] of queryWeights) {
        const frequency = chunk.termFrequencies.get(term) ?? 0;
        if (frequency === 0) continue;

        const idf = inverseDocumentFrequency(
          knowledgeBase.chunks.length,
          knowledgeBase.documentFrequency.get(term) ?? 0,
        );
        dotProduct += queryWeight * (1 + Math.log(frequency)) * idf;
      }

      const cosine =
        queryNorm > 0 && chunk.vectorNorm > 0
          ? dotProduct / (queryNorm * chunk.vectorNorm)
          : 0;

      return { index, score: cosine };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
}

function approximateLexicalBonus(
  queryTerms: string[],
  chunk: IndexedChunk,
  knowledgeBase: KnowledgeBase,
): number {
  const uniqueQueryTerms = [...new Set(queryTerms)];
  const chunkTerms = [...new Set(chunk.tokens)];
  const titleSectionTerms = tokenize(`${chunk.title} ${chunk.section}`);
  let bonus = 0;

  for (const queryTerm of uniqueQueryTerms) {
    const importance = queryTermImportance(queryTerm);

    if (chunk.termFrequencies.has(queryTerm)) {
      const idf = inverseDocumentFrequency(
        knowledgeBase.chunks.length,
        knowledgeBase.documentFrequency.get(queryTerm) ?? 0,
      );
      bonus += importance * Math.min(0.0012, idf * 0.00018);
    } else {
      const approximateTerms = chunkTerms.filter((term) =>
        termsApproximatelyMatch(queryTerm, term),
      );

      if (approximateTerms.length > 0) {
        const bestIdf = Math.max(
          ...approximateTerms.map((term) =>
            inverseDocumentFrequency(
              knowledgeBase.chunks.length,
              knowledgeBase.documentFrequency.get(term) ?? 0,
            ),
          ),
        );
        bonus += importance * Math.min(0.005, bestIdf * 0.0008);
      }
    }

    if (
      titleSectionTerms.some((term) => termsApproximatelyMatch(queryTerm, term))
    ) {
      bonus += importance * 0.0007;
    }
  }

  return Math.min(bonus, 0.015);
}

function sourceIntentBonus(queryTerms: string[], chunk: IndexedChunk): number {
  const hasGroupTerm = queryTerms.some(
    (term) => term.startsWith("grup") || term.startsWith("grub"),
  );
  const hasRelationTerm = queryTerms.some(
    (term) =>
      term === "ait" ||
      term.startsWith("bağlı") ||
      term.startsWith("sahip") ||
      term.startsWith("şirket"),
  );

  // Cevabı hard-code etmiyoruz; sadece doğru kurumsal kaynağı öne alıyoruz.
  if (hasGroupTerm && hasRelationTerm && chunk.url.includes("/hikayemiz")) {
    return 0.012;
  }

  return 0;
}

function buildDirectRanking(
  queryTerms: string[],
  knowledgeBase: KnowledgeBase,
): RankedChunk[] {
  const bm25Rank = rankByBm25(queryTerms, knowledgeBase);
  const tfidfRank = rankByTfidf(queryTerms, knowledgeBase);
  const scores = new Map<number, number>();

  bm25Rank.forEach((entry, rank) => {
    scores.set(
      entry.index,
      (scores.get(entry.index) ?? 0) + 1 / (RRF_K + rank),
    );
  });

  tfidfRank.forEach((entry, rank) => {
    scores.set(
      entry.index,
      (scores.get(entry.index) ?? 0) + 1 / (RRF_K + rank),
    );
  });

  return [...scores.entries()]
    .map(([index, rrfScore]) => {
      const chunk = knowledgeBase.chunks[index];
      return {
        index,
        score:
          rrfScore +
          approximateLexicalBonus(queryTerms, chunk, knowledgeBase) +
          sourceIntentBonus(queryTerms, chunk),
      };
    })
    .sort((left, right) => right.score - left.score);
}

function localChunkRelevance(
  queryTerms: string[],
  chunk: IndexedChunk,
  knowledgeBase: KnowledgeBase,
): number {
  const chunkTerms = [...new Set(chunk.tokens)];
  const titleSectionTerms = tokenize(`${chunk.title} ${chunk.section}`);
  let score = 0;

  for (const queryTerm of new Set(queryTerms)) {
    const importance = queryTermImportance(queryTerm);

    if (chunk.termFrequencies.has(queryTerm)) {
      score +=
        importance *
        inverseDocumentFrequency(
          knowledgeBase.chunks.length,
          knowledgeBase.documentFrequency.get(queryTerm) ?? 0,
        );
    } else {
      const approximateTerms = chunkTerms.filter((term) =>
        termsApproximatelyMatch(queryTerm, term),
      );

      if (approximateTerms.length > 0) {
        score +=
          importance *
          0.9 *
          Math.max(
            ...approximateTerms.map((term) =>
              inverseDocumentFrequency(
                knowledgeBase.chunks.length,
                knowledgeBase.documentFrequency.get(term) ?? 0,
              ),
            ),
          );
      }
    }

    if (
      titleSectionTerms.some((term) => termsApproximatelyMatch(queryTerm, term))
    ) {
      score += importance * 0.6;
    }
  }

  return score;
}

function findBestAnchorInSource(
  seedIndex: number,
  queryTerms: string[],
  knowledgeBase: KnowledgeBase,
): number {
  const seed = knowledgeBase.chunks[seedIndex];
  const sourceIndexes =
    knowledgeBase.sourceChunkIndexes.get(seed.sourceKey) ?? [seedIndex];

  const seedRelevance = localChunkRelevance(queryTerms, seed, knowledgeBase);
  let bestIndex = seedIndex;
  let bestRelevance = seedRelevance;

  for (const index of sourceIndexes) {
    const relevance = localChunkRelevance(
      queryTerms,
      knowledgeBase.chunks[index],
      knowledgeBase,
    );

    if (relevance > bestRelevance) {
      bestIndex = index;
      bestRelevance = relevance;
    }
  }

  return bestIndex !== seedIndex && bestRelevance >= seedRelevance + 0.75
    ? bestIndex
    : seedIndex;
}

function getNeighborWindowIndexes(
  seedIndex: number,
  knowledgeBase: KnowledgeBase,
  radius = NEIGHBOR_RADIUS,
): number[] {
  const seed = knowledgeBase.chunks[seedIndex];
  const sourceIndexes =
    knowledgeBase.sourceChunkIndexes.get(seed.sourceKey) ?? [seedIndex];

  const start = Math.max(0, seed.sourcePosition - radius);
  const end = Math.min(
    sourceIndexes.length,
    seed.sourcePosition + radius + 1,
  );

  return sourceIndexes.slice(start, end);
}

function truncateText(value: string, maxChars: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxChars) return normalized;

  const sliced = normalized.slice(0, maxChars);
  const lastSentenceEnd = Math.max(
    sliced.lastIndexOf("."),
    sliced.lastIndexOf("!"),
    sliced.lastIndexOf("?"),
    sliced.lastIndexOf("\n"),
  );

  if (lastSentenceEnd >= Math.floor(maxChars * 0.6)) {
    return sliced.slice(0, lastSentenceEnd + 1).trim();
  }

  return `${sliced.trim()}…`;
}

function mergeNeighborWindow(
  seedIndex: number,
  seedScore: number,
  queryTerms: string[],
  knowledgeBase: KnowledgeBase,
): RetrievedChunk {
  const anchorIndex = findBestAnchorInSource(
    seedIndex,
    queryTerms,
    knowledgeBase,
  );
  const windowIndexes = getNeighborWindowIndexes(anchorIndex, knowledgeBase);

  const preferredIndex = [...windowIndexes].sort(
    (left, right) =>
      localChunkRelevance(
        queryTerms,
        knowledgeBase.chunks[right],
        knowledgeBase,
      ) -
      localChunkRelevance(
        queryTerms,
        knowledgeBase.chunks[left],
        knowledgeBase,
      ),
  )[0] ?? anchorIndex;

  const preferredChunk = knowledgeBase.chunks[preferredIndex];
  const otherIndexes = windowIndexes
    .filter((index) => index !== preferredIndex)
    .sort(
      (left, right) =>
        knowledgeBase.chunks[left].sourcePosition -
        knowledgeBase.chunks[right].sourcePosition,
    );

  const preferredText = truncateText(
    preferredChunk.text,
    Math.min(1500, MAX_MERGED_TEXT_CHARS),
  );

  let remainingBudget = Math.max(
    0,
    MAX_MERGED_TEXT_CHARS - preferredText.length - 4,
  );
  const textParts = [preferredText];

  for (let i = 0; i < otherIndexes.length; i += 1) {
    if (remainingBudget <= 80) break;

    const remainingSlots = otherIndexes.length - i;
    const partBudget = Math.max(
      80,
      Math.floor(remainingBudget / remainingSlots),
    );
    const neighborText = truncateText(
      knowledgeBase.chunks[otherIndexes[i]].text,
      partBudget,
    );

    if (neighborText) {
      textParts.push(neighborText);
      remainingBudget -= neighborText.length + 2;
    }
  }

  return {
    id: preferredChunk.id,
    parentSourceId: preferredChunk.parentSourceId,
    title: preferredChunk.title,
    url: preferredChunk.url,
    section: preferredChunk.section,
    text: textParts.filter(Boolean).join("\n\n"),
    searchText: [
      preferredChunk.searchText,
      ...otherIndexes.map((index) => knowledgeBase.chunks[index].searchText),
    ]
      .filter(Boolean)
      .join("\n\n"),
    score: seedScore,
  };
}

function windowsOverlap(left: number[], right: number[]): boolean {
  const rightSet = new Set(right);
  return left.some((index) => rightSet.has(index));
}

export function retrieveChunks(
  question: string,
  knowledgeBase: KnowledgeBase,
  limit = 6,
): RetrievedChunk[] {
  const queryTerms = tokenize(question);
  if (queryTerms.length === 0) return [];

  const hasMatchingChunk = knowledgeBase.chunks.some((chunk) =>
    queryTerms.some((term) => chunk.termFrequencies.has(term)),
  );
  if (!hasMatchingChunk) return [];

  const directRanking = buildDirectRanking(queryTerms, knowledgeBase);
  if (directRanking.length === 0) return [];

  const usedWindowsBySource = new Map<string, number[][]>();
  const results: RetrievedChunk[] = [];
  const candidateLimit = Math.min(
    directRanking.length,
    Math.max(limit * MAX_DIRECT_CANDIDATES_MULTIPLIER, limit),
  );

  for (const candidate of directRanking.slice(0, candidateLimit)) {
    if (results.length >= limit) break;

    const seed = knowledgeBase.chunks[candidate.index];
    const anchorIndex = findBestAnchorInSource(
      candidate.index,
      queryTerms,
      knowledgeBase,
    );
    const windowIndexes = getNeighborWindowIndexes(anchorIndex, knowledgeBase);
    const usedWindows = usedWindowsBySource.get(seed.sourceKey) ?? [];

    if (usedWindows.some((usedWindow) => windowsOverlap(usedWindow, windowIndexes))) {
      continue;
    }

    results.push(
      mergeNeighborWindow(
        candidate.index,
        candidate.score,
        queryTerms,
        knowledgeBase,
      ),
    );

    usedWindows.push(windowIndexes);
    usedWindowsBySource.set(seed.sourceKey, usedWindows);
  }

  return results;
}
