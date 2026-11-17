import type { RetrievedChunk } from "./rag-engine";

/**
 * Varsayılan model. İstersen Replit Secrets/Environment üzerinden
 * GEMINI_MODEL tanımlayarak değiştirebilirsin.
 */
export const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

/**
 * 429'u otomatik retry etmiyoruz. Kota/rate-limit durumunda tekrar denemek
 * aynı kotayı daha da tüketebilir. Geçici sunucu hatalarını retry ediyoruz.
 */
const RETRIABLE_STATUS_CODES = new Set([500, 502, 503, 504]);

export type AnswerMode = "llm" | "extractive" | "no_match";

export type RagSource = {
  id: string;
  title: string;
  url: string;
  section: string;
  excerpt: string;
  score: number;
};

export type ProviderResult = {
  answer?: string;
  status?: number;
  error?: string;
};

type ProviderLog = {
  error: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
};

type InteractionTextPart = {
  type?: string;
  text?: string;
};

type InteractionStep = {
  type?: string;
  status?: string;
  text?: string;
  content?: InteractionTextPart[];
};

type InteractionPayload = {
  id?: string;
  status?: string;
  output_text?: string;
  outputs?: Array<{
    type?: string;
    text?: string;
    content?: InteractionTextPart[];
  }>;
  steps?: InteractionStep[];
  errors?: Array<{
    code?: string;
    message?: string;
  }>;
};

function fallbackTokenize(value: string): string[] {
  const stopWords = new Set([
    "acaba",
    "ama",
    "ancak",
    "bana",
    "ben",
    "beni",
    "benim",
    "bir",
    "bu",
    "buna",
    "bunu",
    "bunun",
    "da",
    "daha",
    "de",
    "diye",
    "en",
    "gibi",
    "için",
    "ile",
    "ise",
    "mı",
    "mi",
    "mu",
    "mü",
    "nasıl",
    "ne",
    "nedir",
    "neden",
    "olan",
    "olarak",
    "oldu",
    "olur",
    "şu",
    "ve",
    "veya",
    "var",
    "yok",
  ]);

  const normalized = value
    .toLocaleLowerCase("tr-TR")
    .replace(
      /(\d+)\s*['’]?\s*(si|sı|ü|u)(?=$|[^\p{L}\p{N}])/gu,
      "$1$2",
    );

  return (normalized.match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter(
    (token) => !stopWords.has(token),
  );
}

function termsMatch(left: string, right: string): boolean {
  if (left === right) return true;

  const limit = Math.min(left.length, right.length);
  let prefixLength = 0;

  while (
    prefixLength < limit &&
    left[prefixLength] === right[prefixLength]
  ) {
    prefixLength += 1;
  }

  return prefixLength >= 4;
}

function productVariant(value: string): string | undefined {
  return fallbackTokenize(value).find((term) =>
    /^\d+(?:si|sı|ü|u)$/u.test(term),
  );
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/gu, " ")
    .split(/(?<=[.!?])\s+|\s*[•·]\s*/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 25);
}

export function buildSources(retrieved: RetrievedChunk[]): RagSource[] {
  return retrieved.map((chunk, index) => ({
    id: `K${index + 1}`,
    title: chunk.title,
    url: chunk.url,
    section: chunk.section,
    excerpt: chunk.text.slice(0, 360),
    score: chunk.score,
  }));
}

/**
 * Gemini erişilemezse kaynak parçalarından doğrudan bir cevap üretir.
 * Böylece LLM tek hata noktası olmaz.
 */
export function buildExtractiveAnswer(
  question: string,
  retrieved: RetrievedChunk[],
): string {
  if (retrieved.length === 0) {
    return "Bu soru için bilgi kaynaklarında yeterli bir eşleşme bulamadım.";
  }

  const queryTerms = new Set(fallbackTokenize(question));
  const queryVariant = productVariant(question);

  const candidateChunks = queryVariant
    ? retrieved
        .map((chunk, sourceIndex) => ({ chunk, sourceIndex }))
        .filter(({ chunk }) => {
          const sourceVariant = productVariant(
            `${chunk.title} ${chunk.searchText}`,
          );
          return sourceVariant === queryVariant;
        })
    : retrieved.map((chunk, sourceIndex) => ({ chunk, sourceIndex }));

  const hasTermMatch = candidateChunks.some(({ chunk }) =>
    fallbackTokenize(chunk.searchText).some((term) =>
      [...queryTerms].some((queryTerm) => termsMatch(queryTerm, term)),
    ),
  );

  if (candidateChunks.length === 0 || !hasTermMatch) {
    return "Bu soru için bilgi kaynaklarında yeterli bir eşleşme bulamadım.";
  }

  const candidates: Array<{
    sentence: string;
    sourceIndex: number;
    score: number;
  }> = [];

  candidateChunks.forEach(({ chunk, sourceIndex }) => {
    const sentences = splitSentences(chunk.text);
    const usableSentences =
      sentences.length > 0 ? sentences : [chunk.text.trim()];

    const contextTerms = fallbackTokenize(`${chunk.title} ${chunk.section}`);
    const contextOverlap = [...queryTerms].filter((queryTerm) =>
      contextTerms.some((term) => termsMatch(queryTerm, term)),
    ).length;

    usableSentences.forEach((sentence, sentenceIndex) => {
      if (!sentence) return;

      const sentenceTerms = fallbackTokenize(sentence);
      const overlap = [...queryTerms].filter((queryTerm) =>
        sentenceTerms.some((term) => termsMatch(queryTerm, term)),
      ).length;

      const exactBonus = question
        .toLocaleLowerCase("tr-TR")
        .split(/\s+/u)
        .some(
          (piece) =>
            piece.length >= 5 &&
            sentence.toLocaleLowerCase("tr-TR").includes(piece),
        )
        ? 1.5
        : 0;

      if (overlap === 0 && exactBonus === 0) return;

      const score =
        overlap * 4 +
        contextOverlap * 1.5 +
        exactBonus +
        chunk.score * 30 -
        sentenceIndex * 0.05;

      candidates.push({ sentence, sourceIndex, score });
    });
  });

  candidates.sort((left, right) => right.score - left.score);

  const selected: typeof candidates = [];
  const seen = new Set<string>();
  const minimumScore = (candidates[0]?.score ?? 0) * 0.55;

  for (const candidate of candidates) {
    if (candidate.score < minimumScore) continue;

    const normalized = candidate.sentence.toLocaleLowerCase("tr-TR");
    if (seen.has(normalized)) continue;
    if (candidate.score <= 0 && selected.length > 0) continue;

    selected.push(candidate);
    seen.add(normalized);

    if (selected.length >= 3) break;
  }

  if (selected.length === 0) {
    return `Kaynaklarda bulunan en ilgili bilgi:\n\n${retrieved[0].text.slice(0, 700)} [K1]\n\nBu yanıt doğrudan kaynak metninden gösterilmiştir.`;
  }

  const body = selected
    .map(({ sentence, sourceIndex }) => `${sentence} [K${sourceIndex + 1}]`)
    .join("\n\n");

  return `Kaynaklarda bulunan en ilgili bilgiler:\n\n${body}\n\nBu yanıt doğrudan doğrulanmış kaynak parçalarından oluşturulmuştur.`;
}

/**
 * Interactions API'nin farklı cevap şekillerinden kullanıcıya gösterilecek
 * metni çıkarır. Özellikle REST cevabındaki steps[].content[].text alanını
 * destekler.
 */
function extractInteractionText(payload: InteractionPayload): string {
  const direct = payload.output_text?.trim();
  if (direct) return direct;

  const fromSteps = (payload.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => {
      const values: string[] = [];

      if (typeof step.text === "string" && step.text.trim()) {
        values.push(step.text);
      }

      for (const part of step.content ?? []) {
        if (part.type === "text" && typeof part.text === "string") {
          values.push(part.text);
        }
      }

      return values;
    })
    .join("")
    .trim();

  if (fromSteps) return fromSteps;

  const fromOutputs = (payload.outputs ?? [])
    .flatMap((output) => {
      const values: string[] = [];

      if (typeof output.text === "string" && output.text.trim()) {
        values.push(output.text);
      }

      for (const part of output.content ?? []) {
        if (part.type === "text" && typeof part.text === "string") {
          values.push(part.text);
        }
      }

      return values;
    })
    .join("")
    .trim();

  return fromOutputs;
}

export async function generateWithGemini(args: {
  apiKey: string;
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  sourceContext: string;
  log: ProviderLog;
}): Promise<ProviderResult> {
  const { apiKey, question, history, sourceContext, log } = args;

  const conversationContext = history
    .slice(-6)
    .map(
      (message) =>
        `${message.role === "assistant" ? "Asistan" : "Kullanıcı"}: ${message.content.slice(0, 1000)}`,
    )
    .join("\n");

  const prompt = `${
    conversationContext
      ? `Önceki konuşma:\n${conversationContext}\n\n`
      : ""
  }Soru: ${question}\n\nYalnızca aşağıdaki kaynak parçalarına dayanarak yanıtla.\n\nKurallar:\n- Kaynaklarda olmayan hiçbir bilgiyi ekleme.\n- Her önemli olguyu [K1], [K2] gibi ilgili kaynak etiketiyle destekle.\n- Kullanıcının sorduğu ürünü başka ürün varyantlarıyla karıştırma.\n- Özellikle ürün adı, ürün içeriği ve alerjen bölümlerine dikkat et.\n- Kaynaklarda açık cevap varsa doğrudan ve doğal Türkçe ile cevapla.\n- Kaynaklar yetersizse bunu açıkça söyle.\n\nKaynaklar:\n${sourceContext}`;

  const requestUrl =
    "https://generativelanguage.googleapis.com/v1beta/interactions";

  /**
   * max_output_tokens vermiyoruz. Thinking modellerinde düşük bir limit,
   * düşünme tokenları tarafından tüketilip boş/eksik cevap oluşturabilir.
   */
  const requestBody = JSON.stringify({
    model: MODEL,
    system_instruction:
      "Sen Kahve Dünyası hakkında kaynaklara bağlı yanıt veren bir bilgi asistanısın. Yalnızca verilen kaynakları kullan. Kaynakta bulunmayan bilgiyi uydurma. Ürün varyantlarını birbirine karıştırma. Yanıtı kısa, doğal ve anlaşılır tut. Kaynak işaretlerini [K1] biçiminde koru.",
    input: prompt,
    store: false,
    generation_config: {
      thinking_level: "low",
    },
  });

  let response: Response | undefined;

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: requestBody,
        signal: AbortSignal.timeout(30_000),
      });

      if (
        response.ok ||
        !RETRIABLE_STATUS_CODES.has(response.status) ||
        attempt === 2
      ) {
        break;
      }

      const waitMs = 1000 * 2 ** attempt;
      log.warn(
        {
          providerStatus: response.status,
          attempt: attempt + 1,
          retryInMs: waitMs,
        },
        "Gemini temporary error; retrying",
      );

      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gemini request failed";

    log.warn(
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: message.slice(0, 240),
      },
      "Gemini request failed; using extractive fallback",
    );

    return { error: message.slice(0, 240) };
  }

  if (!response) {
    return { error: "Gemini yanıt vermedi." };
  }

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as
      | {
          error?: {
            status?: string;
            message?: string;
          };
        }
      | null;

    const providerMessage = (errorPayload?.error?.message ?? "")
      .replaceAll(apiKey, "[redacted]")
      .slice(0, 500);

    log.error(
      {
        providerStatus: response.status,
        providerCode: errorPayload?.error?.status,
        providerMessage,
      },
      "Gemini answer generation failed; using extractive fallback",
    );

    return {
      status: response.status,
      error:
        providerMessage ||
        errorPayload?.error?.status ||
        `Gemini HTTP ${response.status}`,
    };
  }

  let payload: InteractionPayload;

  try {
    payload = (await response.json()) as InteractionPayload;
  } catch {
    log.warn(
      { providerStatus: response.status },
      "Gemini returned invalid JSON; using extractive fallback",
    );

    return {
      status: response.status,
      error: "Gemini geçerli bir JSON yanıtı döndürmedi.",
    };
  }

  const answer = extractInteractionText(payload);

  if (!answer) {
    log.warn(
      {
        providerStatus: response.status,
        interactionStatus: payload.status,
        stepTypes: (payload.steps ?? []).map((step) => step.type),
        stepCount: payload.steps?.length ?? 0,
        outputCount: payload.outputs?.length ?? 0,
        hasOutputText: Boolean(payload.output_text),
        providerErrors: payload.errors?.map((item) => item.code ?? item.message),
      },
      "Gemini response received but no text could be extracted; using extractive fallback",
    );

    return {
      status: response.status,
      error: `Gemini yanıtında okunabilir metin bulunamadı (status: ${payload.status ?? "unknown"}).`,
    };
  }

  return {
    answer,
    status: response.status,
  };
}
