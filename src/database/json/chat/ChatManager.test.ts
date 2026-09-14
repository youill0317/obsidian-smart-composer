import { App } from 'obsidian'

import { ChatManager } from './ChatManager'
import { CHAT_SCHEMA_VERSION, ChatConversation } from './types'

const mockAdapter = {
  exists: jest.fn().mockResolvedValue(true),
  mkdir: jest.fn().mockResolvedValue(undefined),
  read: jest.fn().mockResolvedValue(''),
  write: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
  list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
}

const mockVault = {
  adapter: mockAdapter,
}

const mockApp = {
  vault: mockVault,
} as unknown as App

describe('ChatManager', () => {
  let chatManager: ChatManager

  beforeEach(() => {
    jest.clearAllMocks()
    chatManager = new ChatManager(mockApp)
  })

  describe('filename generation and parsing roundtrip', () => {
    const testTitles = [
      'Simple Title',
      'Special & Characters! #$%^',
      'Unicode 中文 日本語 한국어',
      'Extremely long title that might cause issues with file systems',
      'Title with trailing spaces   ',
      '   Title with leading spaces',
      'Title with _ underscores_and_special_chars',
      'Title with.dots.and-dashes',
      'Title with / slashes \\ and \\ backslashes',
      'Title with "quotes" and \'apostrophes\'',
      'Title with <html> tags',
      'Title with newlines\nand\ttabs',
      '🔥 Title with emojis 🚀',
      ' ',
      'Title-with-123e4567-e89b-12d3-a456-426614174000-uuid-like-substring',
      '_Title_starting_with_underscore',
      'Title+with+plus+signs',
      'Title%20with%20encoded%20characters',
      'Title ending with .json',
      'v1_Title_starting_like_a_versioned_file',
      '..Title with leading dots',
      'Title with trailing dots..',
    ]

    test.each(testTitles)('should correctly roundtrip title: %s', (title) => {
      const chat: ChatConversation = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title,
        messages: [],
        createdAt: 1620000000000,
        updatedAt: 1620000000000,
        schemaVersion: CHAT_SCHEMA_VERSION,
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fileName = (chatManager as any).generateFileName(chat)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metadata = (chatManager as any).parseFileName(fileName)

      expect(metadata).not.toBeNull()
      if (metadata) {
        expect(metadata.id).toBe(chat.id)
        expect(metadata.title).toBe(chat.title)
        expect(metadata.updatedAt).toBe(chat.updatedAt)
        expect(metadata.schemaVersion).toBe(chat.schemaVersion)
      }
    })
  })

  it('rejects a migrated chat ID that would escape the chat directory', async () => {
    mockAdapter.exists.mockResolvedValue(false)

    await expect(
      chatManager.createChat({ id: '../../../.obsidian/plugins/example/data' }),
    ).rejects.toThrow('Invalid record ID')
    expect(mockAdapter.write).not.toHaveBeenCalled()
  })

  it('rejects a stored chat with a malformed similarity score', async () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    const fileName = `v1_Chat_1620000000000_${id}.json`
    const chat = {
      id,
      title: 'Chat',
      messages: [
        {
          role: 'user',
          id: 'message',
          content: null,
          promptContent: 'hello',
          mentionables: [],
          similaritySearchResults: [
            {
              id: 1,
              path: 'note.md',
              mtime: 1,
              content: 'text',
              model: 'model',
              dimension: 3,
              metadata: { startLine: 1, endLine: 1 },
              similarity: 'not-a-number',
            },
          ],
        },
      ],
      createdAt: 1620000000000,
      updatedAt: 1620000000000,
      schemaVersion: CHAT_SCHEMA_VERSION,
    }
    mockAdapter.list.mockResolvedValue({
      files: [`.smtcmp_json_db/chats/${fileName}`],
      folders: [],
    })
    mockAdapter.exists.mockResolvedValue(true)
    mockAdapter.read.mockResolvedValue(JSON.stringify(chat))
    jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(chatManager.findById(id)).resolves.toBeNull()
  })

  it('accepts persisted editor state and one-indexed block metadata', async () => {
    const id = 'ABCDEF12-3456-7890-abcd-ef1234567890'
    const fileName = `v1_Chat_1620000000000_${id}.json`
    const chat = {
      id,
      title: 'Chat',
      messages: [
        {
          role: 'user',
          id: 'message',
          content: {
            root: {
              children: [
                {
                  children: [
                    {
                      detail: 0,
                      format: 0,
                      mode: 'normal',
                      style: '',
                      text: 'hello',
                      type: 'text',
                      version: 1,
                    },
                  ],
                  direction: 'ltr',
                  format: '',
                  indent: 0,
                  type: 'paragraph',
                  version: 1,
                  textFormat: 0,
                  textStyle: '',
                },
              ],
              direction: 'ltr',
              format: '',
              indent: 0,
              type: 'root',
              version: 1,
            },
          },
          promptContent: 'hello',
          mentionables: [
            {
              type: 'block',
              content: 'line',
              file: 'note.md',
              startLine: 1,
              endLine: 1,
            },
          ],
          similaritySearchResults: [
            {
              id: 1,
              path: 'note.md',
              mtime: 1,
              content: 'line',
              model: 'model',
              dimension: 3,
              metadata: { startLine: 1, endLine: 1 },
              similarity: 0.75,
            },
          ],
        },
      ],
      createdAt: 1620000000000,
      updatedAt: 1620000000000,
      schemaVersion: CHAT_SCHEMA_VERSION,
    }
    mockAdapter.list.mockResolvedValue({
      files: [`.smtcmp_json_db/chats/${fileName}`],
      folders: [],
    })
    mockAdapter.exists.mockResolvedValue(true)
    mockAdapter.read.mockResolvedValue(JSON.stringify(chat))

    await expect(chatManager.findById(id)).resolves.toEqual(chat)
  })
})
