import { App } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import {
  sanitizeSerializedEditorState,
  sanitizeSerializedMentionables,
} from '../../../utils/chat/serialized-editor-state'
import { AbstractJsonRepository } from '../base'
import { CHAT_DIR, ROOT_DIR } from '../constants'
import { EmptyChatTitleException } from '../exception'
import {
  assertSafeRecordId,
  isFiniteNumber,
  isRecord,
  isSafeRecordId,
} from '../validation'

import {
  CHAT_SCHEMA_VERSION,
  ChatConversation,
  ChatConversationMetadata,
} from './types'

export class ChatManager extends AbstractJsonRepository<
  ChatConversation,
  ChatConversationMetadata
> {
  constructor(app: App) {
    super(app, `${ROOT_DIR}/${CHAT_DIR}`)
  }

  protected generateFileName(chat: ChatConversation): string {
    assertSafeRecordId(chat.id)
    // Format: v{schemaVersion}_{title}_{updatedAt}_{id}.json
    const encodedTitle = encodeURIComponent(chat.title)
    return `v${chat.schemaVersion}_${encodedTitle}_${chat.updatedAt}_${chat.id}.json`
  }

  protected parseFileName(fileName: string): ChatConversationMetadata | null {
    // Parse: v{schemaVersion}_{title}_{updatedAt}_{id}.json
    const regex = new RegExp(
      `^v${CHAT_SCHEMA_VERSION}_(.+)_(\\d+)_([0-9a-f-]+)\\.json$`,
      'i',
    )
    const match = fileName.match(regex)
    if (!match) return null

    const title = decodeURIComponent(match[1])
    const updatedAt = parseInt(match[2], 10)
    const id = match[3]

    return {
      id,
      schemaVersion: CHAT_SCHEMA_VERSION,
      title,
      updatedAt,
    }
  }

  public async createChat(
    initialData: Partial<ChatConversation>,
  ): Promise<ChatConversation> {
    if (initialData.title !== undefined && initialData.title.length === 0) {
      throw new EmptyChatTitleException()
    }

    const now = Date.now()
    const newChat: ChatConversation = {
      id: uuidv4(),
      title: 'New chat',
      messages: [],
      createdAt: now,
      updatedAt: now,
      schemaVersion: CHAT_SCHEMA_VERSION,
      ...initialData,
    }

    assertSafeRecordId(newChat.id)
    const validChat = sanitizeChatConversation(newChat, newChat)
    if (!validChat) throw new Error('Invalid chat record')
    await this.create(validChat)
    return validChat
  }

  public async findById(id: string): Promise<ChatConversation | null> {
    assertSafeRecordId(id)
    const allMetadata = await this.listMetadata()
    const targetMetadata = allMetadata.find((meta) => meta.id === id)

    if (!targetMetadata) return null

    const chat = sanitizeChatConversation(
      await this.read(targetMetadata.fileName),
      targetMetadata,
    )
    if (!chat) {
      console.error(`Invalid chat record: ${targetMetadata.fileName}`)
      return null
    }
    return chat
  }

  public async updateChat(
    id: string,
    updates: Partial<
      Omit<ChatConversation, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>
    >,
  ): Promise<ChatConversation | null> {
    const chat = await this.findById(id)
    if (!chat) return null

    if (updates.title !== undefined && updates.title.length === 0) {
      throw new EmptyChatTitleException()
    }

    const updatedChat: ChatConversation = {
      ...chat,
      ...updates,
      updatedAt: Date.now(),
    }

    const validChat = sanitizeChatConversation(updatedChat, updatedChat)
    if (!validChat) throw new Error('Invalid chat record')
    await this.update(chat, validChat)
    return validChat
  }

  public async deleteChat(id: string): Promise<boolean> {
    assertSafeRecordId(id)
    const allMetadata = await this.listMetadata()
    const targetMetadata = allMetadata.find((meta) => meta.id === id)
    if (!targetMetadata) return false

    await this.delete(targetMetadata.fileName)
    return true
  }

  public async listChats(): Promise<ChatConversationMetadata[]> {
    const metadata = await this.listMetadata()
    return metadata.sort((a, b) => b.updatedAt - a.updatedAt)
  }
}

function sanitizeChatConversation(
  value: unknown,
  metadata: ChatConversationMetadata,
): ChatConversation | null {
  if (
    !isRecord(value) ||
    !isSafeRecordId(value.id) ||
    value.id !== metadata.id ||
    value.title !== metadata.title ||
    value.updatedAt !== metadata.updatedAt ||
    value.schemaVersion !== metadata.schemaVersion ||
    value.schemaVersion !== CHAT_SCHEMA_VERSION ||
    typeof value.title !== 'string' ||
    !isFiniteNumber(value.createdAt) ||
    !Array.isArray(value.messages)
  ) {
    return null
  }

  const messages = value.messages.map(sanitizeSerializedChatMessage)
  if (messages.some((message) => message === null)) return null
  return { ...value, messages } as ChatConversation
}

function sanitizeSerializedChatMessage(value: unknown): unknown | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null

  switch (value.role) {
    case 'user': {
      const content =
        value.content === null
          ? null
          : sanitizeSerializedEditorState(value.content)
      if (value.content !== null && !content) return null
      const mentionables = sanitizeSerializedMentionables(value.mentionables)
      if (!mentionables) return null
      if (
        !isValidPromptContent(value.promptContent) ||
        (value.similaritySearchResults !== undefined &&
          (!Array.isArray(value.similaritySearchResults) ||
            !value.similaritySearchResults.every(isValidSimilarityResult)))
      ) {
        return null
      }
      return { ...value, content, mentionables }
    }
    case 'assistant':
      return typeof value.content === 'string' ? value : null
    case 'tool':
      return Array.isArray(value.toolCalls) &&
        value.toolCalls.every(
          (call) =>
            isRecord(call) &&
            isRecord(call.request) &&
            isRecord(call.response) &&
            typeof call.request.id === 'string' &&
            typeof call.request.name === 'string' &&
            typeof call.response.status === 'string',
        )
        ? value
        : null
    default:
      return null
  }
}

function isValidPromptContent(value: unknown): boolean {
  if (value === null || typeof value === 'string') return true
  return (
    Array.isArray(value) &&
    value.every(
      (part) =>
        isRecord(part) &&
        ((part.type === 'text' && typeof part.text === 'string') ||
          (part.type === 'image_url' &&
            isRecord(part.image_url) &&
            typeof part.image_url.url === 'string')),
    )
  )
}

function isValidSimilarityResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.id) &&
    isFiniteNumber(value.similarity) &&
    typeof value.path === 'string' &&
    typeof value.content === 'string' &&
    typeof value.model === 'string' &&
    isFiniteNumber(value.mtime) &&
    isFiniteNumber(value.dimension) &&
    isRecord(value.metadata) &&
    isFiniteNumber(value.metadata.startLine) &&
    isFiniteNumber(value.metadata.endLine)
  )
}
