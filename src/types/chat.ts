import { SerializedEditorState } from 'lexical'

import { SelectEmbedding } from '../database/schema'

import { ChatModel } from './chat-model.types'
import { ContentPart } from './llm/request'
import { Annotation, ResponseUsage } from './llm/response'
import { Mentionable, SerializedMentionable } from './mentionable'
import { SearchResult } from './search.types'
import { ToolCallRequest, ToolCallResponse } from './tool-call.types'

export type ChatUserMessage = {
  role: 'user'
  content: SerializedEditorState | null
  promptContent: string | ContentPart[] | null
  id: string
  mentionables: Mentionable[]
  similaritySearchResults?: (Omit<SelectEmbedding, 'embedding'> & {
    similarity: number
  })[]
}
export type ChatAssistantMessage = {
  role: 'assistant'
  content: string
  reasoning?: string
  annotations?: Annotation[]
  toolCallRequests?: ToolCallRequest[]
  id: string
  geminiThoughtSignature?: unknown
  metadata?: {
    usage?: ResponseUsage
    model?: ChatModel // TODO: migrate legacy data to new model type
  }
}
export type ChatToolMessage = {
  role: 'tool'
  id: string
  toolCalls: {
    request: ToolCallRequest
    response: ToolCallResponse
  }[]
}

export type ChatWebSearchResultMessage = {
  role: 'web-search-result'
  id: string
  query: string
  results: SearchResult[]
}

export type ChatMessage =
  | ChatUserMessage
  | ChatAssistantMessage
  | ChatToolMessage
  | ChatWebSearchResultMessage

export type AssistantToolMessageGroup = (
  | ChatAssistantMessage
  | ChatToolMessage
)[]

export type SerializedChatUserMessage = {
  role: 'user'
  content: SerializedEditorState | null
  promptContent: string | ContentPart[] | null
  id: string
  mentionables: SerializedMentionable[]
  similaritySearchResults?: (Omit<SelectEmbedding, 'embedding'> & {
    similarity: number
  })[]
}
export type SerializedChatAssistantMessage = {
  role: 'assistant'
  content: string
  reasoning?: string
  annotations?: Annotation[]
  toolCallRequests?: ToolCallRequest[]
  id: string
  geminiThoughtSignature?: unknown
  metadata?: {
    usage?: ResponseUsage
    model?: ChatModel // TODO: migrate legacy data to new model type
  }
}
export type SerializedChatToolMessage = {
  role: 'tool'
  toolCalls: {
    request: ToolCallRequest
    response: ToolCallResponse
  }[]
  id: string
}

export type SerializedChatWebSearchResultMessage = {
  role: 'web-search-result'
  id: string
  query: string
  results: SearchResult[]
}

export type SerializedChatMessage =
  | SerializedChatUserMessage
  | SerializedChatAssistantMessage
  | SerializedChatToolMessage
  | SerializedChatWebSearchResultMessage

export type ChatConversation = {
  schemaVersion: number
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: SerializedChatMessage[]
}
export type ChatConversationMeta = {
  schemaVersion: number
  id: string
  title: string
  createdAt: number
  updatedAt: number
}
