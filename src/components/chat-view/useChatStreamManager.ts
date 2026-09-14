import { UseMutationResult, useMutation } from '@tanstack/react-query'
import { Notice } from 'obsidian'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useApp } from '../../contexts/app-context'
import { useSettings } from '../../contexts/settings-context'
import { useTools } from '../../contexts/tools-context'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
  LLMBaseUrlNotSetException,
  LLMModelNotFoundException,
} from '../../core/llm/exception'
import { getChatModelClient } from '../../core/llm/manager'
import { ChatMessage } from '../../types/chat'
import {
  PromptGenerator,
  createWebContentBudget,
} from '../../utils/chat/promptGenerator'
import { ResponseGenerator } from '../../utils/chat/responseGenerator'
import { ErrorModal } from '../modals/ErrorModal'

import { QueryProgressState } from './QueryProgress'

type SubmitChatParams = {
  chatMessages: ChatMessage[]
  conversationId: string
  resume?: boolean
  useVaultSearch?: boolean
  onQueryProgressChange?: (queryProgress: QueryProgressState) => void
}

type UseChatStreamManagerParams = {
  conversationId: string
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  autoScrollToBottom: () => void
  promptGenerator: PromptGenerator
}

export type UseChatStreamManager = {
  abortActiveStreams: () => void
  submitChatMutation: UseMutationResult<void, Error, SubmitChatParams>
}

export function useChatStreamManager({
  conversationId: currentConversationId,
  setChatMessages,
  autoScrollToBottom,
  promptGenerator,
}: UseChatStreamManagerParams): UseChatStreamManager {
  const app = useApp()
  const { settings, setSettings } = useSettings()
  const toolManager = useTools()

  const budgetRef = useRef<{
    conversationId: string
    cli: { remaining: number }
  } | null>(null)

  const activeStreamAbortControllersRef = useRef<AbortController[]>([])

  const abortActiveStreams = useCallback(() => {
    for (const abortController of activeStreamAbortControllersRef.current) {
      abortController.abort()
    }
    activeStreamAbortControllersRef.current = []
    toolManager.cli.abortConversation(currentConversationId)
  }, [toolManager, currentConversationId])

  useEffect(() => () => abortActiveStreams(), [abortActiveStreams])

  const { providerClient, model } = useMemo(() => {
    try {
      return getChatModelClient({
        modelId: settings.chatModelId,
        settings,
        setSettings,
      })
    } catch (error) {
      if (error instanceof LLMModelNotFoundException) {
        if (settings.chatModels.length === 0) {
          throw error
        }
        // Fallback to the first chat model if the selected chat model is not found
        const firstChatModel = settings.chatModels[0]
        setSettings((current) => ({
          ...current,
          chatModelId: firstChatModel.id,
          chatModels: current.chatModels.map((model) =>
            model.id === firstChatModel.id
              ? {
                  ...model,
                  enable: true,
                }
              : model,
          ),
        }))
        return getChatModelClient({
          modelId: firstChatModel.id,
          settings,
          setSettings,
        })
      }
      throw error
    }
  }, [settings, setSettings])

  const submitChatMutation = useMutation({
    mutationFn: async ({
      chatMessages,
      conversationId,
      resume,
      useVaultSearch,
      onQueryProgressChange,
    }: SubmitChatParams) => {
      const lastMessage = chatMessages.at(-1)
      if (!lastMessage) {
        // chatMessages is empty
        return
      }

      abortActiveStreams()
      const abortController = new AbortController()
      activeStreamAbortControllersRef.current.push(abortController)

      let unsubscribeResponseGenerator: (() => void) | undefined

      try {
        const messagesToCompile = chatMessages.filter(
          (message): message is Extract<ChatMessage, { role: 'user' }> =>
            message.role === 'user' &&
            (message.id === lastMessage.id || !message.promptContent),
        )
        const webContentBudget = createWebContentBudget(messagesToCompile)
        const compiledMessages: ChatMessage[] = []
        for (const message of chatMessages) {
          if (
            message.role === 'user' &&
            (message.id === lastMessage.id || !message.promptContent)
          ) {
            const { promptContent, similaritySearchResults } =
              await promptGenerator.compileUserMessagePrompt({
                message,
                useVaultSearch:
                  message.id === lastMessage.id ? useVaultSearch : undefined,
                onQueryProgressChange:
                  message.id === lastMessage.id
                    ? (progress) => {
                        if (!abortController.signal.aborted) {
                          onQueryProgressChange?.(progress)
                        }
                      }
                    : undefined,
                signal: abortController.signal,
                webContentBudget,
              })
            compiledMessages.push({
              ...message,
              promptContent,
              similaritySearchResults,
            })
          } else {
            compiledMessages.push(message)
          }
        }
        if (abortController.signal.aborted) return
        setChatMessages(compiledMessages)

        const cliEnabled =
          settings.chatOptions.enableTools &&
          toolManager.cli.listAvailableTools().length > 0
        if (cliEnabled) {
          if (!resume)
            budgetRef.current = {
              conversationId,
              cli: { remaining: settings.cli.maxAutoIterations },
            }
        }
        const responseGenerator = new ResponseGenerator({
          providerClient,
          model,
          messages: compiledMessages,
          conversationId,
          enableTools: settings.chatOptions.enableTools,
          maxAutoIterations: settings.chatOptions.maxAutoIterations,
          cliAutoIterationBudget:
            cliEnabled && budgetRef.current?.conversationId === conversationId
              ? budgetRef.current.cli
              : undefined,
          promptGenerator,
          toolManager,
          abortSignal: abortController.signal,
        })

        unsubscribeResponseGenerator = responseGenerator.subscribe(
          (responseMessages) => {
            setChatMessages((prevChatMessages) => {
              const lastMessageIndex = prevChatMessages.findIndex(
                (message) => message.id === lastMessage.id,
              )
              if (lastMessageIndex === -1) {
                // The last message no longer exists in the chat history.
                // This likely means a new message was submitted while this stream was running.
                // Abort this stream and keep the current chat history.
                abortController.abort()
                return prevChatMessages
              }
              return [
                ...prevChatMessages.slice(0, lastMessageIndex + 1),
                ...responseMessages,
              ]
            })
            autoScrollToBottom()
          },
        )

        await responseGenerator.run()
        if (
          cliEnabled &&
          responseGenerator.reachedLimit &&
          budgetRef.current?.conversationId === conversationId &&
          budgetRef.current.cli.remaining <= 0
        )
          new Notice(
            'Automatic CLI round limit reached. Use Continue if more work is needed.',
          )
      } catch (error) {
        abortController.abort()
        // Ignore AbortError
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        throw error
      } finally {
        if (unsubscribeResponseGenerator) {
          unsubscribeResponseGenerator()
        }
        activeStreamAbortControllersRef.current =
          activeStreamAbortControllersRef.current.filter(
            (controller) => controller !== abortController,
          )
      }
    },
    onError: (error) => {
      if (
        error instanceof LLMAPIKeyNotSetException ||
        error instanceof LLMAPIKeyInvalidException ||
        error instanceof LLMBaseUrlNotSetException
      ) {
        new ErrorModal(app, 'Error', error.message, error.rawError?.message, {
          showSettingsButton: true,
        }).open()
      } else {
        new Notice(error.message)
        console.error('Failed to generate response', error)
      }
    },
  })

  return {
    abortActiveStreams,
    submitChatMutation,
  }
}
