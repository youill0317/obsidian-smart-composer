import { ChatUserMessage } from '../../types/chat'

import { createWebContentBudget } from './promptGenerator'

function messageWithUrls(count: number): ChatUserMessage {
  return {
    role: 'user',
    id: String(count),
    content: null,
    promptContent: null,
    mentionables: Array.from({ length: count }, (_, index) => ({
      type: 'url',
      url: `https://example-${index}.com`,
    })),
  }
}

describe('createWebContentBudget', () => {
  it('enforces one URL limit across every message compiled for a request', () => {
    expect(() =>
      createWebContentBudget([messageWithUrls(6), messageWithUrls(5)]),
    ).toThrow('at most 10 URL attachments')
    expect(
      createWebContentBudget([messageWithUrls(6), messageWithUrls(4)]),
    ).toEqual({ urlCount: 10, contentBytes: 0 })
  })
})
