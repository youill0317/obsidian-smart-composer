/**
 * LEGACY CHAT MANAGER
 * This implementation has been deprecated and replaced by the JSON database implementation
 * in src/database/json/chat/ChatManager.ts
 *
 * This file is kept for backward compatibility and migration purposes.
 */

import { App, normalizePath } from 'obsidian'

import {
  assertSafeRecordId,
  isRecord,
  isSafeRecordId,
} from '../../database/json/validation'
import { ChatConversation, ChatConversationMeta } from '../../types/chat'

const CURRENT_SCHEMA_VERSION = 3
const SUPPORTED_SCHEMA_VERSION = 2
const CHAT_HISTORY_DIR = '.smtcmp_chat_histories'
const CHAT_LIST_FILE = 'chat_list.json'

export class ChatConversationManager {
  private app: App

  constructor(app: App) {
    this.app = app
  }

  async createChatConversation(id: string): Promise<ChatConversation> {
    assertSafeRecordId(id)
    const newChatConversation: ChatConversation = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id,
      title: 'New chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    }
    await this.saveChatConversation(newChatConversation)
    return newChatConversation
  }

  async deleteChatConversation(id: string): Promise<void> {
    assertSafeRecordId(id)
    const filePath = this.getChatConversationPath(id)
    await this.app.vault.adapter.remove(filePath)
    const chatList = await this.getChatList()
    const updatedChatList = chatList.filter((chat) => chat.id !== id)
    await this.app.vault.adapter.write(
      this.getChatListPath(),
      JSON.stringify(updatedChatList),
    )
  }

  async findChatConversation(id: string): Promise<ChatConversation | null> {
    assertSafeRecordId(id)
    const filePath = this.getChatConversationPath(id)
    if (await this.app.vault.adapter.exists(filePath)) {
      try {
        const content = await this.app.vault.adapter.read(filePath)
        const chatConversation: unknown = JSON.parse(content)
        if (
          !isRecord(chatConversation) ||
          chatConversation.id !== id ||
          !Array.isArray(chatConversation.messages)
        ) {
          throw new Error('Invalid legacy chat record')
        }
        return chatConversation as ChatConversation
      } catch (error) {
        console.error(`Failed to read legacy chat ${id}`, error)
        return null
      }
    }
    return null
  }

  async saveChatConversation(
    chatConversation: ChatConversation,
  ): Promise<void> {
    assertSafeRecordId(chatConversation.id)
    await this.ensureChatConversationDir()
    const filePath = this.getChatConversationPath(chatConversation.id)
    await this.app.vault.adapter.write(
      filePath,
      JSON.stringify(chatConversation),
    )
    await this.updateChatList(chatConversation)
  }

  async getChatList(): Promise<ChatConversationMeta[]> {
    const chatListPath = this.getChatListPath()
    if (await this.app.vault.adapter.exists(chatListPath)) {
      try {
        const content = await this.app.vault.adapter.read(chatListPath)
        const chatList: unknown = JSON.parse(content)
        if (!Array.isArray(chatList))
          throw new Error('Invalid legacy chat list')
        return chatList.filter(
          (chat): chat is ChatConversationMeta =>
            isRecord(chat) &&
            // TODO: should migrate from 2 to 3
            typeof chat.schemaVersion === 'number' &&
            chat.schemaVersion >= SUPPORTED_SCHEMA_VERSION &&
            isSafeRecordId(chat.id) &&
            typeof chat.title === 'string' &&
            typeof chat.createdAt === 'number' &&
            typeof chat.updatedAt === 'number',
        )
      } catch (error) {
        console.error('Failed to read legacy chat list', error)
        return []
      }
    }
    return []
  }

  private async ensureChatConversationDir() {
    const dirPath = normalizePath(CHAT_HISTORY_DIR)
    if (!(await this.app.vault.adapter.exists(dirPath))) {
      await this.app.vault.createFolder(dirPath)
    }
  }

  private async updateChatList(
    chatConversation: ChatConversation,
  ): Promise<void> {
    const chatList = await this.getChatList()
    const chatMeta: ChatConversationMeta = {
      schemaVersion: chatConversation.schemaVersion,
      id: chatConversation.id,
      title: chatConversation.title,
      createdAt: chatConversation.createdAt,
      updatedAt: chatConversation.updatedAt,
    }
    const existingIndex = chatList.findIndex(
      (chat) => chat.id === chatConversation.id,
    )
    if (existingIndex !== -1) {
      chatList[existingIndex] = chatMeta
    } else {
      chatList.push(chatMeta)
    }
    chatList.sort((a, b) => b.updatedAt - a.updatedAt)
    await this.app.vault.adapter.write(
      this.getChatListPath(),
      JSON.stringify(chatList),
    )
  }

  private getChatListPath(): string {
    return normalizePath(`${CHAT_HISTORY_DIR}/${CHAT_LIST_FILE}`)
  }

  private getChatConversationPath(id: string): string {
    assertSafeRecordId(id)
    return normalizePath(`${CHAT_HISTORY_DIR}/${id}.json`)
  }
}
