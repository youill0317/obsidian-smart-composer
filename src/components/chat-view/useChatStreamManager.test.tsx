import { App } from 'obsidian'
import { renderToStaticMarkup } from 'react-dom/server'

import { useApp } from '../../contexts/app-context'
import { useSettings } from '../../contexts/settings-context'
import { useTools } from '../../contexts/tools-context'
import { getChatModelClient } from '../../core/llm/manager'
import { ToolManager } from '../../core/tools/toolManager'
import { smartComposerSettingsSchema } from '../../settings/schema/setting.types'
import { ChatMessage, ChatUserMessage } from '../../types/chat'
import { PromptGenerator } from '../../utils/chat/promptGenerator'

import { QueryProgressState } from './QueryProgress'
import { useChatStreamManager } from './useChatStreamManager'

type MutationInput = {
  chatMessages: ChatMessage[]
  conversationId: string
  onQueryProgressChange?: (progress: QueryProgressState) => void
}

let mockMutationFn: ((input: MutationInput) => Promise<void>) | undefined

jest.mock('@tanstack/react-query', () => ({
  useMutation: (options: {
    mutationFn: (input: MutationInput) => Promise<void>
  }) => {
    mockMutationFn = options.mutationFn
    return { mutate: jest.fn(), isPending: false }
  },
}))
jest.mock('obsidian', () => ({ Notice: jest.fn() }))
jest.mock('../../contexts/app-context', () => ({ useApp: jest.fn() }))
jest.mock('../../contexts/settings-context', () => ({
  useSettings: jest.fn(),
}))
jest.mock('../../contexts/tools-context', () => ({ useTools: jest.fn() }))
jest.mock('../../core/llm/manager', () => ({
  getChatModelClient: jest.fn(),
}))
jest.mock('../modals/ErrorModal', () => ({ ErrorModal: class {} }))

it('aborts initial prompt compilation before state or provider streaming', async () => {
  const settings = smartComposerSettingsSchema.parse({})
  jest.mocked(useApp).mockReturnValue({} as App)
  jest.mocked(useSettings).mockReturnValue({
    settings,
    setSettings: jest.fn(),
  })
  const abortConversation = jest.fn()
  jest.mocked(useTools).mockReturnValue({
    cli: {
      abortConversation,
      listAvailableTools: jest.fn().mockReturnValue([]),
    },
  } as unknown as ToolManager)
  const streamResponse = jest.fn()
  jest.mocked(getChatModelClient).mockReturnValue({
    providerClient: { streamResponse } as unknown as ReturnType<
      typeof getChatModelClient
    >['providerClient'],
    model: {} as ReturnType<typeof getChatModelClient>['model'],
  })

  let resolveCompilation!: (value: {
    promptContent: string
    shouldUseRAG: boolean
  }) => void
  let compilationStarted!: () => void
  const started = new Promise<void>((resolve) => {
    compilationStarted = resolve
  })
  const compilation = new Promise<{
    promptContent: string
    shouldUseRAG: boolean
  }>((resolve) => {
    resolveCompilation = resolve
  })
  let compilationSignal: AbortSignal | undefined
  let reportProgress: ((progress: QueryProgressState) => void) | undefined
  const compileUserMessagePrompt = jest.fn(
    ({
      signal,
      onQueryProgressChange,
    }: {
      signal?: AbortSignal
      onQueryProgressChange?: (progress: QueryProgressState) => void
    }) => {
      compilationSignal = signal
      reportProgress = onQueryProgressChange
      compilationStarted()
      return compilation
    },
  )
  const promptGenerator = {
    compileUserMessagePrompt,
  } as unknown as PromptGenerator
  const setChatMessages = jest.fn()
  let streamManager!: ReturnType<typeof useChatStreamManager>
  const Harness = () => {
    streamManager = useChatStreamManager({
      conversationId: 'conversation',
      setChatMessages,
      autoScrollToBottom: jest.fn(),
      promptGenerator,
    })
    return null
  }
  renderToStaticMarkup(<Harness />)

  const message: ChatUserMessage = {
    role: 'user',
    id: 'user',
    content: null,
    promptContent: null,
    mentionables: [],
  }
  if (!mockMutationFn) throw new Error('Mutation was not registered')
  let settled = false
  const onQueryProgressChange = jest.fn()
  const running = mockMutationFn({
    chatMessages: [message],
    conversationId: 'conversation',
    onQueryProgressChange,
  }).finally(() => {
    settled = true
  })
  await started

  expect(settled).toBe(false)
  expect(compilationSignal?.aborted).toBe(false)
  reportProgress?.({ type: 'querying' })
  expect(onQueryProgressChange).toHaveBeenCalledTimes(1)
  onQueryProgressChange.mockClear()
  streamManager.abortActiveStreams()
  expect(compilationSignal?.aborted).toBe(true)
  reportProgress?.({ type: 'querying' })
  resolveCompilation({ promptContent: 'compiled', shouldUseRAG: false })
  await running

  expect(abortConversation).toHaveBeenCalledWith('conversation')
  expect(setChatMessages).not.toHaveBeenCalled()
  expect(streamResponse).not.toHaveBeenCalled()
  expect(onQueryProgressChange).not.toHaveBeenCalled()
})
