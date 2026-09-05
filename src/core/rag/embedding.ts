import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { EmbeddingModelClient } from '../../types/embedding'
import { LLMProvider } from '../../types/provider.types'
import { BaseLLMProvider } from '../llm/base'
import { getProviderClient } from '../llm/manager'

export const getEmbeddingModelClient = ({
  settings,
  embeddingModelId,
}: {
  settings: SmartComposerSettings
  embeddingModelId: string
}): EmbeddingModelClient => {
  const embeddingModel = settings.embeddingModels.find(
    (model) => model.id === embeddingModelId,
  )
  if (!embeddingModel) {
    throw new Error(`Embedding model ${embeddingModelId} not found`)
  }

  const providerClient: BaseLLMProvider<LLMProvider> = getProviderClient({
    settings,
    providerId: embeddingModel.providerId,
  })

  return {
    id: embeddingModel.id,
    dimension: embeddingModel.outputDimension ?? embeddingModel.dimension,
    getEmbedding: async (text, options) => {
      const expectedDimension =
        embeddingModel.outputDimension ?? embeddingModel.dimension
      const embedding = await providerClient.getEmbedding(
        embeddingModel.model,
        text,
        {
          dimensions: embeddingModel.outputDimension,
          purpose: options?.purpose,
        },
      )
      if (embedding.length !== expectedDimension) {
        throw new Error(
          `Embedding dimension mismatch: expected ${expectedDimension}, got ${embedding.length}`,
        )
      }
      return embedding
    },
  }
}
