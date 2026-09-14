import { App } from 'obsidian'

import { ChatConversationManager } from './chatHistoryManager'

const mockAdapter = {
  exists: jest.fn().mockResolvedValue(true),
  read: jest.fn(),
  remove: jest.fn().mockResolvedValue(undefined),
  write: jest.fn().mockResolvedValue(undefined),
}

const mockApp = {
  vault: { adapter: mockAdapter },
} as unknown as App

describe('legacy ChatConversationManager', () => {
  beforeEach(() => jest.clearAllMocks())

  it('rejects an escaped chat ID before reading a path', async () => {
    const manager = new ChatConversationManager(mockApp)

    await expect(
      manager.findChatConversation('../../../.obsidian/plugins/example/data'),
    ).rejects.toThrow('Invalid record ID')
    expect(mockAdapter.exists).not.toHaveBeenCalled()
    expect(mockAdapter.read).not.toHaveBeenCalled()
  })

  it('keeps safe UUID-like chat IDs while filtering unsafe migration entries', async () => {
    mockAdapter.read.mockResolvedValue(
      JSON.stringify([
        {
          schemaVersion: 3,
          id: 'ABCDEF12-3456-7890-abcd-ef1234567890',
          title: 'Safe',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          schemaVersion: 3,
          id: '../../../.obsidian/plugins/example/data',
          title: 'Escaped',
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    )
    const manager = new ChatConversationManager(mockApp)

    await expect(manager.getChatList()).resolves.toEqual([
      expect.objectContaining({
        id: 'ABCDEF12-3456-7890-abcd-ef1234567890',
      }),
    ])
  })
})
