import type { AnswerMode, RagSource } from "./rag-assistant";
import { MODEL } from "./rag-assistant";

type PersistenceLog = {
  error: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
};

export async function persistInteraction(args: {
  question: string;
  answer: string;
  answerMode: AnswerMode;
  retrievalCount: number;
  sources: RagSource[];
  providerStatus?: number;
  providerError?: string;
  latencyMs: number;
  log: PersistenceLog;
}): Promise<void> {
  // Konuşma kaydı açık rıza/aydınlatma ve saklama politikası gerektirebilir.
  // Bu nedenle yalnızca operatör açıkça etkinleştirirse kayıt yapılır.
  if (process.env.PERSIST_INTERACTIONS !== "true") {
    return;
  }

  if (!process.env.DATABASE_URL) {
    args.log.warn({}, "DATABASE_URL is missing; RAG interaction was not persisted");
    return;
  }

  try {
    const { db, ragInteractions } = await import("@workspace/db");
    await db.insert(ragInteractions).values({
      question: args.question,
      answer: args.answer,
      answerMode: args.answerMode,
      model: args.answerMode === "llm" ? MODEL : null,
      retrievalCount: args.retrievalCount,
      sources: args.sources,
      providerStatus: args.providerStatus ?? null,
      providerError: args.providerError ?? null,
      latencyMs: args.latencyMs,
    });
  } catch (error) {
    args.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "RAG interaction could not be persisted",
    );
  }
}
