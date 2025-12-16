CREATE INDEX "embeddings_embedding_3072_index" ON "embeddings" USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops) WHERE dimension = 3072;--> statement-breakpoint
