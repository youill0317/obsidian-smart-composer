import { llmProviderSchema } from './provider.types'

it('drops the ChatGPT email from the plaintext registration', () => {
  const provider = llmProviderSchema.parse({
    type: 'openai-plan',
    id: 'openai-plan',
    registration: { clientId: 'client', subject: 'sub', email: 'a@b.c' },
  })
  expect(provider.type === 'openai-plan' && provider.registration).toEqual({
    clientId: 'client',
    subject: 'sub',
  })
})
