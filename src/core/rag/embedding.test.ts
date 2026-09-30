import { DEFAULT_EMBEDDING_MODELS } from '../../constants'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { getProviderClient } from '../llm/manager'

import { getEmbeddingModelClient } from './embedding'

jest.mock('../llm/manager', () => ({
  getProviderClient: jest.fn(),
}))

const mockedGetProviderClient = jest.mocked(getProviderClient)

const settings = {
  providers: [{ type: 'voyage', id: 'voyage' }],
  embeddingModels: [
    {
      providerType: 'voyage',
      providerId: 'voyage',
      id: 'voyage/test',
      model: 'voyage-4',
      dimension: 1024,
      outputDimension: 3,
    },
  ],
} as unknown as SmartComposerSettings

describe('getEmbeddingModelClient', () => {
  it('forwards the embedding purpose and effective dimension', async () => {
    const getEmbedding = jest.fn().mockResolvedValue([0.1, 0.2, 0.3])
    mockedGetProviderClient.mockReturnValue({ getEmbedding } as never)

    const client = getEmbeddingModelClient({
      settings,
      embeddingModelId: 'voyage/test',
    })

    await expect(
      client.getEmbedding('query text', { purpose: 'query' }),
    ).resolves.toEqual([0.1, 0.2, 0.3])
    expect(client.dimension).toBe(3)
    expect(getEmbedding).toHaveBeenCalledWith('voyage-4', 'query text', {
      dimensions: 3,
      purpose: 'query',
    })
  })

  it('uses the Gemini embedding default of 3072 without requesting a dimension override', async () => {
    const values = Array(3072).fill(0.1)
    const getEmbedding = jest.fn().mockResolvedValue(values)
    mockedGetProviderClient.mockReturnValue({ getEmbedding } as never)
    const client = getEmbeddingModelClient({
      settings: { ...settings, embeddingModels: [...DEFAULT_EMBEDDING_MODELS] },
      embeddingModelId: 'gemini/gemini-embedding-2',
    })
    expect(client.dimension).toBe(3072)
    await expect(client.getEmbedding('document')).resolves.toEqual(values)
    expect(getEmbedding).toHaveBeenCalledWith(
      'gemini-embedding-2',
      'document',
      {
        dimensions: undefined,
        purpose: undefined,
      },
    )
  })

  it('rejects an embedding whose dimension does not match settings', async () => {
    mockedGetProviderClient.mockReturnValue({
      getEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
    } as never)

    const client = getEmbeddingModelClient({
      settings,
      embeddingModelId: 'voyage/test',
    })

    await expect(client.getEmbedding('document text')).rejects.toThrow(
      'Embedding dimension mismatch: expected 3, got 2',
    )
  })
})
