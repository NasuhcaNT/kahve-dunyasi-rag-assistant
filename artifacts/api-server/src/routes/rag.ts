import { Router, type IRouter } from "express";
import {
  AskRagQuestionBody,
  AskRagQuestionResponse,
  GetRagMetaResponse,
  GetRagSuggestionsResponse,
} from "@workspace/api-zod";
import { loadKnowledgeBase, retrieveChunks } from "../lib/rag-engine";
import {
  buildExtractiveAnswer,
  buildSources,
  generateWithGemini,
  MODEL,
  type AnswerMode,
} from "../lib/rag-assistant";
import { persistInteraction } from "../lib/rag-persistence";

const router: IRouter = Router();
const knowledgeBasePromise = loadKnowledgeBase();

/**
 * Son gerçek Gemini çağrısının durumunu bellekte tutar.
 * Uygulama ilk açıldığında henüz Gemini çağrısı yapılmadığı için false'tur.
 */
let lastLlmAvailable = false;

const suggestions = [
  "Damla sakızlı 2'si 1 arada kahvenin içeriğinde ne var?",
  "Damla sakızlı 2'si 1 arada hazır kahvede süt veya soya alerjeni var mı?",
  "Üye olmadan alışveriş yapabilir miyim?",
  "Kahve Dünyası üretim sürecini nasıl anlatıyor?",
  "Franchise hakkında hangi bilgiler bulunuyor?",
];

router.get("/rag/meta", async (_req, res): Promise<void> => {
  try {
    const knowledgeBase = await knowledgeBasePromise;
    const hasApiKey = Boolean(process.env.GEMINI_API_KEY);

    res.json(
      GetRagMetaResponse.parse({
        isReady: true,
        llmAvailable: hasApiKey && lastLlmAvailable,
        documentCount: knowledgeBase.documentCount,
        chunkCount: knowledgeBase.chunks.length,
        sourceCount: knowledgeBase.sourceCount,
        model: hasApiKey
          ? `${MODEL} + extractive fallback`
          : "Extractive source mode",
        retrievalStrategy: "BM25 + TF-IDF + RRF",
      }),
    );
  } catch (error) {
    res.status(503).json({
      error:
        error instanceof Error
          ? `Bilgi kaynağı yüklenemedi: ${error.message}`
          : "Bilgi kaynağı yüklenemedi.",
    });
  }
});

router.get("/rag/suggestions", (_req, res): void => {
  res.json(
    GetRagSuggestionsResponse.parse({
      questions: suggestions,
    }),
  );
});

router.post("/rag/ask", async (req, res): Promise<void> => {
  const startedAt = Date.now();
  const parsed = AskRagQuestionBody.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Lütfen geçerli bir soru yazın.",
    });
    return;
  }

  try {
    const knowledgeBase = await knowledgeBasePromise;
    const retrieved = retrieveChunks(parsed.data.question, knowledgeBase);

    if (retrieved.length === 0) {
      const answer =
        "Bu soru için yüklenen bilgi kaynaklarında eşleşen bir içerik bulamadım. Soruyu ürün, içerik, alerjen veya sipariş bilgisiyle ilgili olacak şekilde yeniden sorabilirsiniz.";
      const answerMode: AnswerMode = "no_match";

      await persistInteraction({
        question: parsed.data.question,
        answer,
        answerMode,
        retrievalCount: 0,
        sources: [],
        latencyMs: Date.now() - startedAt,
        log: req.log,
      });

      res.json(
        AskRagQuestionResponse.parse({
          answer,
          sources: [],
          retrievalCount: 0,
          answerMode,
        }),
      );
      return;
    }

    const sources = buildSources(retrieved);

    const sourceContext = retrieved
      .map(
        (chunk, index) =>
          `[K${index + 1}] ${chunk.title}\nBölüm: ${chunk.section}\nURL: ${chunk.url}\nİçerik: ${chunk.text.slice(0, 2400)}`,
      )
      .join("\n\n---\n\n");

    const history = (parsed.data.history ?? []).slice(-6).map((message) => ({
      role:
        message.role === "assistant"
          ? ("assistant" as const)
          : ("user" as const),
      content: message.content,
    }));

    const apiKey = process.env.GEMINI_API_KEY;

    let answer: string;
    let answerMode: AnswerMode;
    let providerStatus: number | undefined;
    let providerError: string | undefined;

    if (apiKey) {
      const geminiResult = await generateWithGemini({
        apiKey,
        question: parsed.data.question,
        history,
        sourceContext,
        log: req.log,
      });

      providerStatus = geminiResult.status;
      providerError = geminiResult.error;

      if (geminiResult.answer?.trim()) {
        answer = geminiResult.answer.trim();
        answerMode = "llm";
        lastLlmAvailable = true;
      } else {
        answer = buildExtractiveAnswer(parsed.data.question, retrieved);
        answerMode = "extractive";
        lastLlmAvailable = false;
      }
    } else {
      answer = buildExtractiveAnswer(parsed.data.question, retrieved);
      answerMode = "extractive";
      lastLlmAvailable = false;
      providerError = "GEMINI_API_KEY yapılandırılmamış.";
    }

    await persistInteraction({
      question: parsed.data.question,
      answer,
      answerMode,
      retrievalCount: retrieved.length,
      sources,
      providerStatus,
      providerError,
      latencyMs: Date.now() - startedAt,
      log: req.log,
    });

    /**
     * Gemini çalışmasa bile bilgi tabanı cevap ürettiyse HTTP 200 döner.
     * Böylece frontend genel hata ekranına düşmez.
     */
    res.json(
      AskRagQuestionResponse.parse({
        answer,
        sources,
        retrievalCount: retrieved.length,
        answerMode,
      }),
    );
  } catch (error) {
    req.log.error(
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      "RAG request failed",
    );

    res.status(503).json({
      error: "Bilgi tabanı şu anda kullanılamıyor. Lütfen biraz sonra tekrar deneyin.",
    });
  }
});

export default router;
