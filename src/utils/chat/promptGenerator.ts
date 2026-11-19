import { App, htmlToMarkdown } from 'obsidian'

import { editorStateToPlainText } from '../../components/chat-view/chat-input/utils/editor-state-to-plain-text'
import { QueryProgressState } from '../../components/chat-view/QueryProgress'
import { getClientHistoryLimit } from '../../core/llm/modelCompatibility'
import { RAGEngine } from '../../core/rag/ragEngine'
import { SelectEmbedding } from '../../database/schema'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import {
  ChatAssistantMessage,
  ChatMessage,
  ChatToolMessage,
  ChatUserMessage,
  CurrentFileCapture,
} from '../../types/chat'
import { ChatModel } from '../../types/chat-model.types'
import { ContentPart, RequestMessage } from '../../types/llm/request'
import {
  MentionableBlock,
  MentionableFile,
  MentionableFolder,
  MentionableImage,
  MentionableUrl,
  MentionableVault,
} from '../../types/mentionable'
import { PromptLevel } from '../../types/prompt-level.types'
import { ToolCallResponseStatus } from '../../types/tool-call.types'
import {
  MAX_FETCHED_TEXT_LENGTH,
  isPublicHttpUrl,
  requestPublicUrl,
} from '../fetch-utils'
import { tokenCount } from '../llm/token'
import {
  getNestedFiles,
  readMultipleTFiles,
  readTFileContent,
} from '../obsidian'

import { YoutubeTranscript, isYoutubeUrl } from './youtube-transcript'

export class PromptGenerator {
  private getRagEngine: () => Promise<RAGEngine>
  private app: App
  private settings: SmartComposerSettings

  constructor(
    getRagEngine: () => Promise<RAGEngine>,
    app: App,
    settings: SmartComposerSettings,
  ) {
    this.getRagEngine = getRagEngine
    this.app = app
    this.settings = settings
  }

  public async generateRequestMessages({
    messages,
    model,
    contextWindow,
  }: {
    messages: ChatMessage[]
    model: Pick<ChatModel, 'providerType' | 'model'>
    // The model's context window, when the provider reported one
    contextWindow?: number
  }): Promise<{
    requestMessages: RequestMessage[]
    // Id of the first chat message sent, when older ones were left out
    requestStartId?: string
  }> {
    if (messages.length === 0) {
      throw new Error('No messages provided')
    }

    // Ensure all user messages have prompt content
    // This is a fallback for cases where compilation was missed earlier in the process
    const compiledMessages = await Promise.all(
      messages.map(async (message) => {
        if (message.role === 'user' && !message.promptContent) {
          const { promptContent, similaritySearchResults } =
            await this.compileUserMessagePrompt({
              message,
            })
          return {
            ...message,
            promptContent,
            similaritySearchResults,
          }
        }
        return message
      }),
    )

    if (!compiledMessages.some((message) => message.role === 'user')) {
      throw new Error('No user messages found')
    }

    // Everything before the newest message must stay byte-identical between
    // requests so provider prompt caches can match the prefix
    const systemMessage = this.getSystemMessage()

    const customInstructionMessage = this.getCustomInstructionMessage()

    // Only the latest current-file capture is rendered
    const capturingMessage = compiledMessages
      .filter((m): m is ChatUserMessage => m.role === 'user' && !!m.currentFile)
      .pop()
    const start = this.getHistoryStart({
      messages: compiledMessages,
      model,
      contextWindow,
      fixedChars: [systemMessage, customInstructionMessage].reduce(
        (sum, message) => sum + (message ? getRequestMessageChars(message) : 0),
        0,
      ),
      currentFileChars: capturingMessage?.currentFile
        ? this.getCurrentFilePrompt(capturingMessage.currentFile).length
        : 0,
      captureIndex: capturingMessage
        ? compiledMessages.indexOf(capturingMessage)
        : -1,
    })
    const keptMessages = compiledMessages.slice(start)

    const requestMessages: RequestMessage[] = [
      systemMessage,
      ...(customInstructionMessage ? [customInstructionMessage] : []),
      ...this.getChatHistoryMessages({
        messages: keptMessages,
        // A dropped capture moves to the first message sent
        currentFile: capturingMessage?.currentFile && {
          message: keptMessages.includes(capturingMessage)
            ? capturingMessage
            : keptMessages[0],
          capture: capturingMessage.currentFile,
        },
      }),
    ]

    return {
      requestMessages,
      requestStartId: start > 0 ? keptMessages[0].id : undefined,
    }
  }

  // Index of the first chat message to send. Whole turns are dropped from the
  // start so the request fits the model's context window: a cut recorded on an
  // earlier reply is kept, and it moves forward once the request would reach
  // the limit. Turns are sized by apportioning the provider-reported input
  // tokens of the last request by character length.
  private getHistoryStart({
    messages,
    model,
    contextWindow,
    fixedChars,
    currentFileChars,
    captureIndex,
  }: {
    messages: ChatMessage[]
    model: Pick<ChatModel, 'providerType' | 'model'>
    contextWindow?: number
    fixedChars: number
    currentFileChars: number
    captureIndex: number
  }): number {
    let currentTurn = 0
    messages.forEach((message, index) => {
      if (message.role === 'user') currentTurn = index
    })
    // A cut must name a user message that still exists up to the current turn
    const cutIndex = (id: string | undefined, before: number) => {
      const index = id ? messages.findIndex((m) => m.id === id) : -1
      return index > 0 && index <= before && messages[index].role === 'user'
        ? index
        : 0
    }

    let start = 0
    let lastReply = -1
    messages.forEach((message, index) => {
      if (message.role !== 'assistant') return
      start = Math.max(start, cutIndex(message.requestStartId, currentTurn))
      if (message.metadata?.usage) lastReply = index
    })

    const historyLimit = getClientHistoryLimit(model, contextWindow)
    if (!historyLimit || lastReply < 0) return start

    const chars = messages.map((message) => this.getMessageChars(message))
    const sumChars = (from: number, to: number) =>
      chars.slice(from, to).reduce((sum, c) => sum + c, 0)

    // Characters of the request that produced the last reply
    const reply = messages[lastReply] as ChatAssistantMessage
    let replyStart = cutIndex(reply.requestStartId, lastReply)
    let compactionChars = 0
    const replyModel = reply.metadata?.model
    if (replyModel && !getClientHistoryLimit(replyModel)) {
      // The provider's adapter sends nothing before its latest compaction
      for (let i = replyStart; i < lastReply; i++) {
        const message = messages[i]
        if (message.role !== 'assistant') continue
        if (replyModel.providerType === 'anthropic') {
          const compaction = message.providerMetadata?.anthropic?.compaction
          if (compaction) {
            replyStart = i
            compactionChars = compaction.content.length
          }
        } else if (
          (replyModel.providerType === 'openai' ||
            replyModel.providerType === 'openai-plan') &&
          message.providerMetadata?.openai?.compaction
        ) {
          replyStart = i
          compactionChars = 0
        }
      }
    }
    const replyRequestChars =
      fixedChars +
      (captureIndex < lastReply ? currentFileChars : 0) +
      compactionChars +
      sumChars(replyStart, lastReply)
    const promptTokens = reply.metadata?.usage?.prompt_tokens ?? 0
    if (replyRequestChars <= 0 || promptTokens <= 0) return start
    const tokensPerChar = promptTokens / replyRequestChars

    const estimate = (from: number) =>
      tokensPerChar *
      (fixedChars + currentFileChars + sumChars(from, messages.length))
    if (estimate(start) < historyLimit.limit) return start
    for (let i = start + 1; i < currentTurn; i++) {
      if (messages[i].role === 'user' && estimate(i) <= historyLimit.target) {
        return i
      }
    }
    return currentTurn
  }

  private getMessageChars(message: ChatMessage): number {
    const requestMessages: RequestMessage[] =
      message.role === 'user'
        ? [{ role: 'user', content: message.promptContent ?? '' }]
        : message.role === 'assistant'
          ? this.parseAssistantMessage({ message })
          : this.parseToolMessage({ message })
    return requestMessages.reduce(
      (sum, m) => sum + getRequestMessageChars(m),
      0,
    )
  }

  private getChatHistoryMessages({
    messages,
    currentFile,
  }: {
    messages: ChatMessage[]
    currentFile?: { message: ChatMessage; capture: CurrentFileCapture }
  }): RequestMessage[] {
    // Send the whole conversation so the original request stays in context
    // during long tool runs and the prompt prefix stays cacheable
    const requestMessages: RequestMessage[] = messages.flatMap(
      (message): RequestMessage[] => {
        if (message.role === 'user') {
          // We assume that all user messages have been compiled
          const promptContent = message.promptContent ?? ''
          if (message !== currentFile?.message) {
            return [{ role: 'user', content: promptContent }]
          }
          const currentFilePrompt = this.getCurrentFilePrompt(
            currentFile.capture,
          )
          const textIndex =
            typeof promptContent === 'string'
              ? -1
              : promptContent.findIndex((part) => part.type === 'text')
          return [
            {
              role: 'user',
              content:
                typeof promptContent === 'string'
                  ? `${currentFilePrompt}${promptContent}`
                  : promptContent.map((part, index) =>
                      index === textIndex && part.type === 'text'
                        ? { ...part, text: `${currentFilePrompt}${part.text}` }
                        : part,
                    ),
            },
          ]
        } else if (message.role === 'assistant') {
          return this.parseAssistantMessage({ message })
        } else {
          // message.role === 'tool'
          return this.parseToolMessage({ message })
        }
      },
    )

    // TODO: Also verify that tool messages appear right after their corresponding assistant tool calls
    const filteredRequestMessages: RequestMessage[] = requestMessages
      .map((msg) => {
        switch (msg.role) {
          case 'user':
            return msg
          case 'assistant': {
            // Filter out tool calls that don't have a corresponding tool message
            const filteredToolCalls = msg.tool_calls?.filter((t) =>
              requestMessages.some(
                (rm) => rm.role === 'tool' && rm.tool_call.id === t.id,
              ),
            )
            return {
              ...msg,
              tool_calls:
                filteredToolCalls && filteredToolCalls.length > 0
                  ? filteredToolCalls
                  : undefined,
            }
          }
          case 'tool': {
            // Filter out tool messages that don't have a corresponding assistant message
            const assistantMessage = requestMessages.find(
              (rm) =>
                rm.role === 'assistant' &&
                rm.tool_calls?.some((t) => t.id === msg.tool_call.id),
            )
            if (!assistantMessage) {
              return null
            } else {
              return msg
            }
          }
          default:
            return msg
        }
      })
      .filter((m) => m !== null)

    return filteredRequestMessages
  }

  private parseAssistantMessage({
    message,
  }: {
    message: ChatAssistantMessage
  }): RequestMessage[] {
    let citationContent: string | null = null
    if (message.annotations && message.annotations.length > 0) {
      citationContent = `Citations:
${message.annotations
  .map((annotation, index) => {
    if (annotation.type === 'url_citation') {
      const { url, title } = annotation.url_citation
      return `[${index + 1}] ${title ? `${title}: ` : ''}${url}`
    }
  })
  .join('\n')}`
    }

    return [
      {
        role: 'assistant',
        content: [
          message.content,
          ...(citationContent ? [citationContent] : []),
        ].join('\n'),
        tool_calls: message.toolCallRequests,
        providerMetadata: message.providerMetadata,
      },
    ]
  }

  private parseToolMessage({
    message,
  }: {
    message: ChatToolMessage
  }): RequestMessage[] {
    return message.toolCalls.map((toolCall) => {
      switch (toolCall.response.status) {
        case ToolCallResponseStatus.PendingApproval:
        case ToolCallResponseStatus.Running:
        case ToolCallResponseStatus.Rejected:
        case ToolCallResponseStatus.Aborted:
          return {
            role: 'tool',
            tool_call: toolCall.request,
            content: `Tool call ${toolCall.request.id} is ${toolCall.response.status}`,
          }
        case ToolCallResponseStatus.Success:
          return {
            role: 'tool',
            tool_call: toolCall.request,
            content: toolCall.response.data.text,
          }
        case ToolCallResponseStatus.Error:
          return {
            role: 'tool',
            tool_call: toolCall.request,
            content: `Error: ${toolCall.response.error}`,
          }
      }
    })
  }

  public async compileUserMessagePrompt({
    message,
    useVaultSearch,
    onQueryProgressChange,
  }: {
    message: ChatUserMessage
    useVaultSearch?: boolean
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void
  }): Promise<{
    promptContent: ChatUserMessage['promptContent']
    shouldUseRAG: boolean
    similaritySearchResults?: (Omit<SelectEmbedding, 'embedding'> & {
      similarity: number
    })[]
  }> {
    try {
      if (!message.content) {
        return {
          promptContent: '',
          shouldUseRAG: false,
        }
      }
      const query = editorStateToPlainText(message.content)
      let similaritySearchResults = undefined

      useVaultSearch =
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        useVaultSearch ||
        message.mentionables.some(
          (m): m is MentionableVault => m.type === 'vault',
        )

      onQueryProgressChange?.({
        type: 'reading-mentionables',
      })
      const files = message.mentionables
        .filter((m): m is MentionableFile => m.type === 'file')
        .map((m) => m.file)
      const folders = message.mentionables
        .filter((m): m is MentionableFolder => m.type === 'folder')
        .map((m) => m.folder)
      const nestedFiles = folders.flatMap((folder) =>
        getNestedFiles(folder, this.app.vault),
      )
      const allFiles = [...files, ...nestedFiles]
      const fileContents = await readMultipleTFiles(allFiles, this.app.vault)

      // Count tokens incrementally to avoid long processing times on large content sets
      const exceedsTokenThreshold = async () => {
        let accTokenCount = 0
        for (const content of fileContents) {
          const count = await tokenCount(content)
          accTokenCount += count
          if (accTokenCount > this.settings.ragOptions.thresholdTokens) {
            return true
          }
        }
        return false
      }
      const shouldUseRAG = useVaultSearch || (await exceedsTokenThreshold())

      let filePrompt: string
      if (shouldUseRAG) {
        similaritySearchResults = useVaultSearch
          ? await (
              await this.getRagEngine()
            ).processQuery({
              query,
              onQueryProgressChange: onQueryProgressChange,
            }) // TODO: Add similarity boosting for mentioned files or folders
          : await (
              await this.getRagEngine()
            ).processQuery({
              query,
              scope: {
                files: files.map((f) => f.path),
                folders: folders.map((f) => f.path),
              },
              onQueryProgressChange: onQueryProgressChange,
            })
        filePrompt = `## Potentially Relevant Snippets from the current vault
${similaritySearchResults
  .map(({ path, content, metadata }) => {
    const newContent =
      this.getModelPromptLevel() == PromptLevel.Default
        ? this.addLineNumbersToContent({
            content,
            startLine: metadata.startLine,
          })
        : content
    return `\`\`\`${path}\n${newContent}\n\`\`\`\n`
  })
  .join('')}\n${
          this.getModelPromptLevel() == PromptLevel.Default
            ? this.getRagInstructionPrompt()
            : ''
        }`
      } else {
        filePrompt = allFiles
          .map((file, index) => {
            return `\`\`\`${file.path}\n${fileContents[index]}\n\`\`\`\n`
          })
          .join('')
      }

      const blocks = message.mentionables.filter(
        (m): m is MentionableBlock => m.type === 'block',
      )
      const blockPrompt = blocks
        .map(({ file, content }) => {
          return `\`\`\`${file.path}\n${content}\n\`\`\`\n`
        })
        .join('')

      const urls = message.mentionables.filter(
        (m): m is MentionableUrl => m.type === 'url',
      )

      const urlPrompt =
        urls.length > 0
          ? `## Potentially Relevant Websearch Results
${(
  await Promise.all(
    urls.map(
      async ({ url }) => `\`\`\`
Website URL: ${url}
Website Content:
${await this.getWebsiteContent(url)}
\`\`\``,
    ),
  )
).join('\n')}
`
          : ''

      const imageDataUrls = message.mentionables
        .filter((m): m is MentionableImage => m.type === 'image')
        .map(({ data }) => data)

      // Reset query progress
      onQueryProgressChange?.({
        type: 'idle',
      })

      return {
        promptContent: [
          ...imageDataUrls.map(
            (data): ContentPart => ({
              type: 'image_url',
              image_url: {
                url: data,
              },
            }),
          ),
          {
            type: 'text',
            text: `${filePrompt}${blockPrompt}${urlPrompt}\n\n${query}\n\n`,
          },
        ],
        shouldUseRAG,
        similaritySearchResults: similaritySearchResults,
      }
    } catch (error) {
      console.error('Failed to compile user message', error)
      onQueryProgressChange?.({
        type: 'idle',
      })
      throw error
    }
  }

  private getSystemMessage(): RequestMessage {
    const modelPromptLevel = this.getModelPromptLevel()
    const systemPrompt = `You are an intelligent assistant to help answer any questions that the user has${modelPromptLevel == PromptLevel.Default ? `, particularly about editing and organizing markdown files in Obsidian` : ''}.

1. Please keep your response as concise as possible. Avoid being verbose.

2. Do not lie or make up facts.

3. Format your response in markdown.

${
  modelPromptLevel == PromptLevel.Default
    ? `4. Respond in the same language as the user's message.

5. When writing out new markdown blocks, also wrap them with <smtcmp_block> tags. For example:
<smtcmp_block language="markdown">
{{ content }}
</smtcmp_block>

6. When providing markdown blocks for an existing file, add the filename and language attributes to the <smtcmp_block> tags. Restate the relevant section or heading, so the user knows which part of the file you are editing. For example:
<smtcmp_block filename="path/to/file.md" language="markdown">
## Section Title
...
{{ content }}
...
</smtcmp_block>

7. When the user is asking for edits to their markdown, please provide a simplified version of the markdown block emphasizing only the changes. Use comments to show where unchanged content has been skipped. Wrap the markdown block with <smtcmp_block> tags. Add filename and language attributes to the <smtcmp_block> tags. For example:
<smtcmp_block filename="path/to/file.md" language="markdown">
<!-- ... existing content ... -->
{{ edit_1 }}
<!-- ... existing content ... -->
{{ edit_2 }}
<!-- ... existing content ... -->
</smtcmp_block>
The user has full access to the file, so they prefer seeing only the changes in the markdown. Often this will mean that the start/end of the file will be skipped, but that's okay! Rewrite the entire file only if specifically requested. Always provide a brief explanation of the updates, except when the user specifically asks for just the content.
`
    : ''
}`

    return {
      role: 'system',
      content: systemPrompt,
    }
  }

  private getCustomInstructionMessage(): RequestMessage | null {
    const customInstruction = this.settings.systemPrompt.trim()
    if (!customInstruction) {
      return null
    }
    return {
      role: 'user',
      content: `Here are additional instructions to follow in your responses when relevant. There's no need to explicitly acknowledge them:
<custom_instructions>
${customInstruction}
</custom_instructions>`,
    }
  }

  public async captureCurrentFile({
    message,
    previousMessages,
  }: {
    message: ChatUserMessage
    previousMessages: ChatMessage[]
  }): Promise<CurrentFileCapture | undefined> {
    const currentFile = message.mentionables.find(
      (m) => m.type === 'current-file',
    )?.file
    if (!currentFile || !this.settings.chatOptions.includeCurrentFileContent) {
      return undefined
    }
    const content = await readTFileContent(currentFile, this.app.vault)
    const liveCapture = previousMessages
      .filter((m): m is ChatUserMessage => m.role === 'user' && !!m.currentFile)
      .pop()?.currentFile
    if (
      liveCapture?.path === currentFile.path &&
      liveCapture.content === content
    ) {
      return undefined
    }
    return { path: currentFile.path, content }
  }

  private getCurrentFilePrompt({ path, content }: CurrentFileCapture): string {
    return `# Inputs
## Current File
Here is the file I'm looking at.
\`\`\`${path}
${content}
\`\`\`\n\n`
  }

  private getRagInstructionPrompt(): string {
    return `If you need to reference any of the markdown blocks I gave you, add the startLine and endLine attributes to the <smtcmp_block> tags without any content inside. Write related content outside of the <smtcmp_block> tags. The content inside the <smtcmp_block> tags will be ignored and replaced with the actual content of the markdown block. For example:
<smtcmp_block filename="path/to/file.md" language="markdown" startLine="200" endLine="310"></smtcmp_block>

Never include line numbers in the output markdown. When writing out new markdown blocks, remember not to include "line_number|" at the beginning of each line.
`
  }

  private addLineNumbersToContent({
    content,
    startLine,
  }: {
    content: string
    startLine: number
  }): string {
    const lines = content.split('\n')
    const linesWithNumbers = lines.map((line, index) => {
      return `${startLine + index}|${line}`
    })
    return linesWithNumbers.join('\n')
  }

  /**
   * TODO: Improve markdown conversion logic
   * - filter visually hidden elements
   * ...
   */
  private async getWebsiteContent(url: string): Promise<string> {
    if (!isPublicHttpUrl(url)) {
      return 'Not fetched: local and private network addresses are blocked.'
    }
    if (isYoutubeUrl(url)) {
      try {
        // TODO: pass language based on user preferences
        const { title, transcript } =
          await YoutubeTranscript.fetchTranscriptAndMetadata(url)

        return `Title: ${title}
Video Transcript:
${transcript
  .map((t) => `${t.offset}: ${t.text}`)
  .join('\n')
  .slice(0, MAX_FETCHED_TEXT_LENGTH)}`
      } catch (error) {
        console.error('Error fetching YouTube transcript', error)
      }
    }

    const response = await requestPublicUrl({ url })
    return htmlToMarkdown(response.text.slice(0, MAX_FETCHED_TEXT_LENGTH))
  }

  private getModelPromptLevel(): PromptLevel {
    const chatModel = this.settings.chatModels.find(
      (model) => model.id === this.settings.chatModelId,
    )
    return chatModel?.promptLevel ?? PromptLevel.Default
  }
}

// Characters of the text sent for a message; images are not counted
function getRequestMessageChars(message: RequestMessage): number {
  let chars =
    typeof message.content === 'string'
      ? message.content.length
      : message.content.reduce(
          (sum, part) => sum + (part.type === 'text' ? part.text.length : 0),
          0,
        )
  if (message.role === 'assistant') {
    chars += message.providerMetadata?.deepseek?.reasoningContent?.length ?? 0
    for (const toolCall of message.tool_calls ?? []) {
      chars += toolCall.name.length + (toolCall.arguments?.length ?? 0)
    }
  }
  return chars
}
