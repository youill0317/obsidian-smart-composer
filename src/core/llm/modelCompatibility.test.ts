import { ChatModel } from '../../types/chat-model.types'

import {
  getClientHistoryLimit,
  needsContextWindowLookup,
} from './modelCompatibility'

const chatModel = (providerType: string, model: string) =>
  ({ providerType, providerId: providerType, id: model, model }) as ChatModel

describe('getClientHistoryLimit', () => {
  it.each(['gpt-6.2-sol', 'any-other-model'])(
    'leaves %s to Responses API compaction',
    (model) => {
      expect(getClientHistoryLimit(chatModel('openai', model))).toBeNull()
    },
  )

  it('leaves every Claude model to server-side compaction', () => {
    expect(
      getClientHistoryLimit(chatModel('anthropic', 'claude-opus-6')),
    ).toBeNull()
  })

  it('trims at the default window for models without compaction', () => {
    expect(getClientHistoryLimit(chatModel('mistral', 'any'))).toEqual({
      limit: 272_000,
      target: 190_400,
    })
  })

  it('uses the window the provider reported for models outside the table', () => {
    const added = chatModel('gemini', 'gemini-4-argon')
    expect(needsContextWindowLookup(added)).toBe(true)
    expect(getClientHistoryLimit(added, 2_000_000)).toEqual({
      limit: 2_000_000,
      target: 1_400_000,
    })
  })

  it('uses the window entered for providers without a models API', () => {
    const local = chatModel('ollama', 'local')
    expect(needsContextWindowLookup(local)).toBe(true)
    expect(getClientHistoryLimit(local, 32_768)).toEqual({
      limit: 32_768,
      target: 32_768 * 0.7,
    })
  })

  it('skips the lookup for table models and for provider compaction', () => {
    const carbon = chatModel('gemini', 'gemini-4-carbon')
    expect(needsContextWindowLookup(carbon)).toBe(false)
    expect(getClientHistoryLimit(carbon, 5)?.limit).toBe(1_048_576)
    expect(needsContextWindowLookup(chatModel('openai', 'any'))).toBe(false)
  })
})
