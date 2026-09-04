export type EmbeddingPurpose = 'query' | 'document'

export type EmbeddingRequestOptions = {
  purpose?: EmbeddingPurpose
}

export type EmbeddingModelClient = {
  id: string
  dimension: number
  getEmbedding: (
    text: string,
    options?: EmbeddingRequestOptions,
  ) => Promise<number[]>
}

export type EmbeddingDbStats = {
  model: string
  rowCount: number
  totalDataBytes: number
}
