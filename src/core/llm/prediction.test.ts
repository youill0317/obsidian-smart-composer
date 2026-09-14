import OpenAI from 'openai'

import { OpenAIMessageAdapter } from './openaiMessageAdapter'

it.each([
  ['https://api.openai.com/v1', 'gpt-4.1', true],
  ['https://api.openai.com/v1/', 'gpt-4o-mini-2024-07-18', true],
  ['https://api.openai.com/v1', 'gpt-6-astra', false],
  ['http://localhost:11434/v1', 'gpt-4.1', false],
  ['https://gateway.example/v1', 'gpt-4o', false],
])(
  'only sends prediction to a supported OpenAI endpoint and model (%s, %s)',
  async (baseURL, model, supported) => {
    const prediction = { type: 'content' as const, content: 'note content' }
    const create = jest.fn().mockResolvedValue({
      choices: [
        {
          message: { role: 'assistant', content: 'edited note' },
          finish_reason: 'stop',
        },
      ],
    })
    const client = {
      baseURL,
      chat: { completions: { create } },
    } as unknown as OpenAI
    await new OpenAIMessageAdapter().generateResponse(client, {
      model,
      messages: [{ role: 'user', content: 'note content' }],
      prediction,
    })
    expect(create.mock.calls[0][0].prediction).toEqual(
      supported ? prediction : undefined,
    )
  },
)
