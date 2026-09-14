import { renderToStaticMarkup } from 'react-dom/server'

import { useApp } from '../contexts/app-context'
import { ChatManager } from '../database/json/chat/ChatManager'
import { ChatToolMessage } from '../types/chat'
import { ToolCallResponseStatus as Status } from '../types/tool-call.types'

import { useChatHistory } from './useChatHistory'
import { useChatManager } from './useJsonManagers'

jest.mock('../contexts/app-context', () => ({ useApp: jest.fn() }))
jest.mock('./useJsonManagers', () => ({ useChatManager: jest.fn() }))
jest.mock('lodash.debounce', () => ({
  default: jest.requireActual('lodash.debounce'),
}))
jest.mock('lodash.isequal', () => ({
  default: jest.requireActual('lodash.isequal'),
}))
jest.mock(
  '../components/chat-view/chat-input/utils/editor-state-to-plain-text',
  () => ({
    editorStateToPlainText: () => 'Test',
  }),
)
jest.mock('../utils/chat/mentionable', () => ({
  serializeMentionable: jest.fn(),
  deserializeMentionable: jest.fn(),
}))

it('saves interrupted tool calls as aborted without changing live or completed results', async () => {
  jest.useFakeTimers()
  try {
    const manager = {
      findById: jest.fn().mockResolvedValue({ id: 'original', messages: [] }),
      updateChat: jest.fn().mockResolvedValue(null),
      listChats: jest.fn().mockResolvedValue([]),
    }
    jest.mocked(useApp).mockReturnValue({} as ReturnType<typeof useApp>)
    jest
      .mocked(useChatManager)
      .mockReturnValue(manager as unknown as ChatManager)
    let history!: ReturnType<typeof useChatHistory>
    const Harness = () => {
      history = useChatHistory()
      return null
    }
    renderToStaticMarkup(<Harness />)
    const message: ChatToolMessage = {
      role: 'tool',
      id: 'message',
      toolCalls: [
        {
          request: { id: 'active', name: 'sc_cli_execute' },
          response: { status: Status.Running },
        },
        {
          request: { id: 'done', name: 'sc_cli_execute' },
          response: {
            status: Status.Success,
            data: { type: 'text', text: 'done' },
          },
        },
        {
          request: { id: 'pending', name: 'sc_cli_execute' },
          response: { status: Status.PendingApproval },
        },
      ],
    }
    history.createOrUpdateConversation('original', [message])
    await jest.advanceTimersByTimeAsync(300)
    const saved = manager.updateChat.mock.calls[0][1].messages[0]
    expect(manager.updateChat.mock.calls[0][0]).toBe('original')
    expect(saved.toolCalls[0].response.status).toBe(Status.Aborted)
    expect(message.toolCalls[0].response.status).toBe(Status.Running)
    expect(saved.toolCalls.slice(1)).toEqual(message.toolCalls.slice(1))
    manager.findById.mockResolvedValue({ id: 'original', messages: [saved] })
    expect(await history.getChatMessagesById('original')).toEqual([saved])

    // Successful completion while still visible replaces the interrupted snapshot.
    message.toolCalls[0].response = {
      status: Status.Success,
      data: { type: 'text', text: 'finished' },
    }
    history.createOrUpdateConversation('original', [message])
    await jest.advanceTimersByTimeAsync(300)
    expect(manager.updateChat.mock.calls[1][1].messages[0]).toEqual(message)

    // Histories written by older builds also must not reopen as permanently running.
    saved.toolCalls[0].response = { status: Status.Running }
    const reopened = await history.getChatMessagesById('original')
    expect(
      reopened?.[0].role === 'tool' && reopened[0].toolCalls[0].response.status,
    ).toBe(Status.Aborted)
  } finally {
    jest.useRealTimers()
  }
})
