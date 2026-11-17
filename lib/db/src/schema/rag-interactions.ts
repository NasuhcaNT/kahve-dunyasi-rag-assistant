import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export type RagInteractionSource = {
  id: string;
  title: string;
  url: string;
  section: string;
  excerpt: string;
  score: number;
};

export const ragInteractions = pgTable("rag_interactions", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  answerMode: varchar("answer_mode", { length: 32 }).notNull(),
  model: varchar("model", { length: 128 }),
  retrievalCount: integer("retrieval_count").notNull().default(0),
  sources: jsonb("sources").$type<RagInteractionSource[]>().notNull(),
  providerStatus: integer("provider_status"),
  providerError: text("provider_error"),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type RagInteraction = typeof ragInteractions.$inferSelect;
export type NewRagInteraction = typeof ragInteractions.$inferInsert;