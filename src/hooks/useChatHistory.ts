import debounce from 'lodash.debounce'
import isEqual from 'lodash.isequal'
import { App } from 'obsidian'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { editorStateToPlainText } from '../components/chat-view/chat-input/utils/editor-state-to-plain-text'
import { useApp } from '../contexts/app-context'
import { ChatConversationMetadata } from '../database/json/chat/types'
import {
  ChatMessage,
  ChatToolMessage,
  SerializedChatMessage,
} from '../types/chat'
import { Mentionable } from '../types/mentionable'
import { ToolCallResponseStatus } from '../types/tool-call.types'
import {
  deserializeMentionable,
  serializeMentionable,
} from '../utils/chat/mentionable'

import { useChatManager } from './useJsonManagers'

type UseChatHistory = {
  createOrUpdateConversation: (
    id: string,
    messages: ChatMessage[],
  ) => Promise<void> | undefined
  deleteConversation: (id: string) => Promise<void>
  getChatMessagesById: (id: string) => Promise<ChatMessage[] | null>
  updateConversationTitle: (id: string, title: string) => Promise<void>
  chatList: ChatConversationMetadata[]
}

export function useChatHistory(): UseChatHistory {
  const app = useApp()
  const chatManager = useChatManager()
  const [chatList, setChatList] = useState<ChatConversationMetadata[]>([])
  const pendingSaves = useMemo(
    () => new Map<string, ReturnType<typeof debounce>>(),
    [],
  )
  const inflightWrites = useMemo(() => new Map<string, Promise<void>>(), [])
  const deletedConversationIds = useMemo(() => new Set<string>(), [])

  const fetchChatList = useCallback(async () => {
    const list = await chatManager.listChats()
    setChatList(list)
  }, [chatManager])

  useEffect(() => {
    void fetchChatList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveConversation = useCallback(
    async (id: string, messages: ChatMessage[]): Promise<void> => {
      if (deletedConversationIds.has(id)) return

      const serializedMessages = messages.map(serializeChatMessage)
      const existingConversation = await chatManager.findById(id)
      if (deletedConversationIds.has(id)) return

      if (existingConversation) {
        if (isEqual(existingConversation.messages, serializedMessages)) return
        await chatManager.updateChat(existingConversation.id, {
          messages: serializedMessages,
        })
      } else {
        const firstUserMessage = messages.find((v) => v.role === 'user')

        await chatManager.createChat({
          id,
          title: firstUserMessage?.content
            ? editorStateToPlainText(firstUserMessage.content).substring(0, 50)
            : 'New chat',
          messages: serializedMessages,
        })
      }

      await fetchChatList()
    },
    [chatManager, deletedConversationIds, fetchChatList],
  )

  const queueWrite = useCallback(
    (id: string, write: () => Promise<void>): Promise<void> => {
      const previous = inflightWrites.get(id) ?? Promise.resolve()
      const current = previous.catch(() => undefined).then(write)
      inflightWrites.set(id, current)
      void current.then(
        () => {
          if (inflightWrites.get(id) === current) inflightWrites.delete(id)
        },
        () => {
          if (inflightWrites.get(id) === current) inflightWrites.delete(id)
        },
      )
      return current
    },
    [inflightWrites],
  )

  const queueSave = useCallback(
    (id: string, messages: ChatMessage[]): void => {
      void queueWrite(id, () => saveConversation(id, messages)).catch((error) =>
        console.error(`Failed to save chat ${id}`, error),
      )
    },
    [queueWrite, saveConversation],
  )

  const createOrUpdateConversation = useCallback(
    (id: string, messages: ChatMessage[]): undefined => {
      if (deletedConversationIds.has(id)) return

      let pendingSave = pendingSaves.get(id)
      if (!pendingSave) {
        pendingSave = debounce(
          (latestMessages: ChatMessage[]) => queueSave(id, latestMessages),
          300,
          { maxWait: 1000 },
        )
        pendingSaves.set(id, pendingSave)
      }
      pendingSave(messages)
    },
    [deletedConversationIds, pendingSaves, queueSave],
  )

  useEffect(
    () => () => {
      for (const pendingSave of pendingSaves.values()) {
        pendingSave.flush()
      }
    },
    [pendingSaves],
  )

  const deleteConversation = useCallback(
    async (id: string): Promise<void> => {
      deletedConversationIds.add(id)
      pendingSaves.get(id)?.cancel()
      pendingSaves.delete(id)
      await inflightWrites.get(id)?.catch(() => undefined)
      await chatManager.deleteChat(id)
      await fetchChatList()
    },
    [
      chatManager,
      deletedConversationIds,
      fetchChatList,
      inflightWrites,
      pendingSaves,
    ],
  )

  const getChatMessagesById = useCallback(
    async (id: string): Promise<ChatMessage[] | null> => {
      const conversation = await chatManager.findById(id)
      if (!conversation) {
        return null
      }
      return conversation.messages.map((message) =>
        deserializeChatMessage(message, app),
      )
    },
    [chatManager, app],
  )

  const updateConversationTitle = useCallback(
    async (id: string, title: string): Promise<void> => {
      if (title.length === 0) {
        throw new Error('Chat title cannot be empty')
      }
      if (deletedConversationIds.has(id)) {
        throw new Error('Conversation not found')
      }
      await queueWrite(id, async () => {
        if (deletedConversationIds.has(id)) {
          throw new Error('Conversation not found')
        }
        const conversation = await chatManager.findById(id)
        if (!conversation || deletedConversationIds.has(id)) {
          throw new Error('Conversation not found')
        }
        await chatManager.updateChat(conversation.id, { title })
        await fetchChatList()
      })
    },
    [chatManager, deletedConversationIds, fetchChatList, queueWrite],
  )

  return {
    createOrUpdateConversation,
    deleteConversation,
    getChatMessagesById,
    updateConversationTitle,
    chatList,
  }
}

// A running process cannot be resumed from a saved conversation.
// Persist an interrupted snapshot; a result received while visible replaces it.
const snapshotToolCalls = (toolCalls: ChatToolMessage['toolCalls']) =>
  toolCalls.map((call) =>
    call.response.status === ToolCallResponseStatus.Running
      ? {
          ...call,
          response: { status: ToolCallResponseStatus.Aborted as const },
        }
      : call,
  )

const serializeChatMessage = (message: ChatMessage): SerializedChatMessage => {
  switch (message.role) {
    case 'user':
      return {
        role: 'user',
        content: message.content,
        promptContent: message.promptContent,
        id: message.id,
        mentionables: message.mentionables.map(serializeMentionable),
        similaritySearchResults: message.similaritySearchResults,
      }
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        reasoning: message.reasoning,
        annotations: message.annotations,
        toolCallRequests: message.toolCallRequests,
        id: message.id,
        metadata: message.metadata,
        providerMetadata: message.providerMetadata,
      }
    case 'tool':
      return {
        role: 'tool',
        toolCalls: snapshotToolCalls(message.toolCalls),
        id: message.id,
      }
  }
}

const deserializeChatMessage = (
  message: SerializedChatMessage,
  app: App,
): ChatMessage => {
  switch (message.role) {
    case 'user': {
      return {
        role: 'user',
        content: message.content,
        promptContent: message.promptContent,
        id: message.id,
        mentionables: message.mentionables
          .map((m) => deserializeMentionable(m, app))
          .filter((m): m is Mentionable => m !== null),
        similaritySearchResults: message.similaritySearchResults,
      }
    }
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        reasoning: message.reasoning,
        annotations: message.annotations,
        toolCallRequests: message.toolCallRequests,
        id: message.id,
        metadata: message.metadata,
        providerMetadata: message.providerMetadata,
      }
    case 'tool':
      return {
        role: 'tool',
        toolCalls: snapshotToolCalls(message.toolCalls),
        id: message.id,
      }
  }
}
