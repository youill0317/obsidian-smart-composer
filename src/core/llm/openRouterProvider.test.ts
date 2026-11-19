import { ChatModel } from '../../types/chat-model.types'

import { OpenRouterProvider } from './openRouterProvider'

const model: ChatModel = {
  providerType: 'openrouter',
  providerId: 'openrouter',
  id: 'openrouter/model',
  model: 'vendor/model',
}

describe('OpenRouterProvider', () => {
  const setup = () => {
    const provider = new OpenRouterProvider({
      type: 'openrouter',
      id: 'openrouter',
      apiKey: 'key',
    })
    const create = jest.fn()
    ;(
      provider as unknown as {
        client: { chat: { completions: { create: jest.Mock } } }
      }
    ).client.chat.completions.create = create
    return { provider, create }
  }

  it('enables context compression on non-streaming requests', async () => {
    const { provider, create } = setup()
    create.mockResolvedValue({
      id: 'r',
      choices: [],
      created: 0,
      model: model.model,
      object: 'chat.completion',
    })
    await provider.generateResponse(model, {
      model: model.model,
      messages: [{ role: 'user', content: 'Hi' }],
    })
    expect(create.mock.calls[0][0]).toMatchObject({
      model: 'vendor/model',
      plugins: [{ id: 'context-compression' }],
    })
  })

  it('enables context compression on streaming requests', async () => {
    const { provider, create } = setup()
    create.mockResolvedValue((async function* () {})())
    await provider.streamResponse(model, {
      model: model.model,
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    })
    expect(create.mock.calls[0][0]).toMatchObject({
      stream: true,
      plugins: [{ id: 'context-compression' }],
    })
  })
})
