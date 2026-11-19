import { App, Notice } from 'obsidian'
import { useState } from 'react'

import {
  GEMINI_THINKING_LEVELS,
  MANUAL_CONTEXT_WINDOW_PROVIDERS,
  REASONING_EFFORTS,
} from '../../../../core/llm/modelCompatibility'
import SmartComposerPlugin from '../../../../main'
import { ChatModel, chatModelSchema } from '../../../../types/chat-model.types'
import { ObsidianButton } from '../../../common/ObsidianButton'
import { ObsidianDropdown } from '../../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../../common/ObsidianSetting'
import { ObsidianToggle } from '../../../common/ObsidianToggle'
import { ReactModal } from '../../../common/ReactModal'

import {
  ContextWindowSetting,
  parseContextWindow,
} from './ContextWindowSetting'

type SettingsComponentProps = {
  model: ChatModel
  plugin: SmartComposerPlugin
  onClose: () => void
}

export class ChatModelSettingsModal extends ReactModal<SettingsComponentProps> {
  constructor(model: ChatModel, app: App, plugin: SmartComposerPlugin) {
    const modelSettings = getModelSettings(model)
    super({
      app: app,
      Component: modelSettings
        ? modelSettings.SettingsComponent
        : () => <div>No settings available for this model</div>,
      props: { model, plugin },
      options: {
        title: `Edit Chat Model: ${model.id}`,
      },
    })
  }
}

type ModelSettingsRegistry = {
  check: (model: ChatModel) => boolean
  SettingsComponent: React.FC<SettingsComponentProps>
}

/**
 * Registry of available model settings.
 *
 * The check function is used to determine if the model settings should be displayed.
 * The SettingsComponent is the component that will be displayed when the model settings are opened.
 */
const MODEL_SETTINGS_REGISTRY: ModelSettingsRegistry[] = [
  /**
   * OpenAI model settings
   */
  {
    check: (model) => model.providerType === 'openai',

    SettingsComponent: (props: SettingsComponentProps) => {
      const { model, plugin, onClose } = props
      const typedModel = model as ChatModel & { providerType: 'openai' }
      const [reasoningEffort, setReasoningEffort] = useState<string>(
        (REASONING_EFFORTS as readonly string[]).includes(
          typedModel.reasoning?.reasoning_effort ?? '',
        )
          ? (typedModel.reasoning?.reasoning_effort ?? '')
          : '',
      )

      const handleSubmit = async () => {
        const updatedModel = {
          ...typedModel,
          reasoning: reasoningEffort
            ? { reasoning_effort: reasoningEffort }
            : undefined,
        }

        const validationResult = chatModelSchema.safeParse(updatedModel)
        if (!validationResult.success) {
          new Notice(
            validationResult.error.issues.map((v) => v.message).join('\n'),
          )
          return
        }

        await plugin.setSettings((current) => ({
          ...current,
          chatModels: current.chatModels.map((m) =>
            m.id === model.id ? updatedModel : m,
          ),
        }))
        onClose()
      }

      return (
        <>
          <ObsidianSetting name="Reasoning Effort">
            <ObsidianDropdown
              value={reasoningEffort}
              options={{
                '': 'Not set (OpenAI default)',
                ...Object.fromEntries(
                  REASONING_EFFORTS.map((effort) => [effort, effort]),
                ),
              }}
              onChange={(value: string) => setReasoningEffort(value)}
            />
          </ObsidianSetting>

          <ObsidianSetting>
            <ObsidianButton text="Save" onClick={handleSubmit} cta />
            <ObsidianButton text="Cancel" onClick={onClose} />
          </ObsidianSetting>
        </>
      )
    },
  },

  /**
   * OpenAI Codex model settings
   */
  {
    check: (model) => model.providerType === 'openai-plan',

    SettingsComponent: (props: SettingsComponentProps) => {
      const { model, plugin, onClose } = props
      const typedModel = model as ChatModel & { providerType: 'openai-plan' }
      const [reasoningEffort, setReasoningEffort] = useState<string>(
        (REASONING_EFFORTS as readonly string[]).includes(
          typedModel.reasoning?.reasoning_effort ?? '',
        )
          ? (typedModel.reasoning?.reasoning_effort ?? '')
          : '',
      )
      const [reasoningSummary, setReasoningSummary] = useState<string>(
        typedModel.reasoning?.reasoning_summary ?? '',
      )

      const handleSubmit = async () => {
        const updatedReasoning = {
          reasoning_effort: reasoningEffort || undefined,
          reasoning_summary: reasoningSummary || undefined,
        }
        const updatedModel = {
          ...typedModel,
          reasoning:
            updatedReasoning.reasoning_effort ||
            updatedReasoning.reasoning_summary
              ? updatedReasoning
              : undefined,
        }

        const validationResult = chatModelSchema.safeParse(updatedModel)
        if (!validationResult.success) {
          new Notice(
            validationResult.error.issues.map((v) => v.message).join('\n'),
          )
          return
        }

        await plugin.setSettings((current) => ({
          ...current,
          chatModels: current.chatModels.map((m) =>
            m.id === model.id ? updatedModel : m,
          ),
        }))
        onClose()
      }

      return (
        <>
          <ObsidianSetting
            name="Reasoning Effort"
            desc="Controls how much thinking the model does before responding."
          >
            <ObsidianDropdown
              value={reasoningEffort}
              options={{
                '': 'Not set (OpenAI default)',
                ...Object.fromEntries(
                  REASONING_EFFORTS.map((effort) => [effort, effort]),
                ),
              }}
              onChange={(value: string) => setReasoningEffort(value)}
            />
          </ObsidianSetting>
          <ObsidianSetting
            name="Reasoning Summary"
            desc="Optional summary of reasoning."
          >
            <ObsidianDropdown
              value={reasoningSummary}
              options={{
                '': 'Not set (OpenAI default)',
                auto: 'auto',
                concise: 'concise',
                detailed: 'detailed',
              }}
              onChange={(value: string) => setReasoningSummary(value)}
            />
          </ObsidianSetting>

          <ObsidianSetting>
            <ObsidianButton text="Save" onClick={handleSubmit} cta />
            <ObsidianButton text="Cancel" onClick={onClose} />
          </ObsidianSetting>
        </>
      )
    },
  },

  /**
   * Claude model settings
   *
   * For extended thinking, see:
   * @see https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
   */
  {
    check: (model) => model.providerType === 'anthropic',
    SettingsComponent: (props: SettingsComponentProps) => {
      const { model, plugin, onClose } = props
      const typedModel = model as ChatModel & { providerType: 'anthropic' }
      const [effort, setEffort] = useState<string>(
        (REASONING_EFFORTS as readonly string[]).includes(
          typedModel.adaptive_thinking?.effort ?? '',
        )
          ? (typedModel.adaptive_thinking?.effort ?? '')
          : '',
      )
      const [showSummaries, setShowSummaries] = useState<boolean>(
        typedModel.adaptive_thinking?.show_summaries ?? false,
      )

      const handleSubmit = async () => {
        const updatedModel = {
          ...typedModel,
          adaptive_thinking:
            effort || showSummaries
              ? {
                  effort: effort || undefined,
                  show_summaries: showSummaries || undefined,
                }
              : undefined,
        }

        const validationResult = chatModelSchema.safeParse(updatedModel)
        if (!validationResult.success) {
          new Notice(
            validationResult.error.issues.map((v) => v.message).join('\n'),
          )
          return
        }

        await plugin.setSettings((current) => ({
          ...current,
          chatModels: current.chatModels.map((m) =>
            m.id === model.id ? updatedModel : m,
          ),
        }))
        onClose()
      }

      return (
        <>
          <ObsidianSetting name="Reasoning Effort">
            <ObsidianDropdown
              value={effort}
              options={{
                '': 'Not set (Anthropic default)',
                ...Object.fromEntries(
                  REASONING_EFFORTS.map((value) => [value, value]),
                ),
              }}
              onChange={(value: string) => setEffort(value)}
            />
          </ObsidianSetting>
          <ObsidianSetting name="Include Thought Summaries">
            <ObsidianToggle
              value={showSummaries}
              onChange={(value: boolean) => setShowSummaries(value)}
            />
          </ObsidianSetting>

          <ObsidianSetting>
            <ObsidianButton text="Save" onClick={handleSubmit} cta />
            <ObsidianButton text="Cancel" onClick={onClose} />
          </ObsidianSetting>
        </>
      )
    },
  },

  /**
   * Gemini model settings
   *
   * For thinking, see:
   * @see https://ai.google.dev/gemini-api/docs/thinking
   */
  {
    check: (model) => model.providerType === 'gemini',
    SettingsComponent: (props: SettingsComponentProps) => {
      const { model, plugin, onClose } = props
      const typedModel = model as ChatModel & { providerType: 'gemini' }
      const [thinkingLevel, setThinkingLevel] = useState<string>(
        (GEMINI_THINKING_LEVELS as readonly string[]).includes(
          typedModel.thinking?.thinking_level ?? '',
        )
          ? (typedModel.thinking?.thinking_level ?? '')
          : '',
      )
      const [includeThoughts, setIncludeThoughts] = useState<boolean>(
        Boolean(typedModel.thinking?.include_thoughts ?? false),
      )

      const handleSubmit = async () => {
        const updatedModel = {
          ...typedModel,
          thinking:
            thinkingLevel || includeThoughts
              ? {
                  thinking_level: thinkingLevel || undefined,
                  include_thoughts: includeThoughts || undefined,
                }
              : undefined,
        }

        const validationResult = chatModelSchema.safeParse(updatedModel)
        if (!validationResult.success) {
          new Notice(
            validationResult.error.issues.map((v) => v.message).join('\n'),
          )
          return
        }

        await plugin.setSettings((current) => ({
          ...current,
          chatModels: current.chatModels.map((m) =>
            m.id === model.id ? updatedModel : m,
          ),
        }))
        onClose()
      }

      return (
        <>
          <ObsidianSetting name="Thinking Level">
            <ObsidianDropdown
              value={thinkingLevel}
              options={{
                '': 'Not set (Gemini default)',
                ...Object.fromEntries(
                  GEMINI_THINKING_LEVELS.map((level) => [level, level]),
                ),
              }}
              onChange={(value: string) => setThinkingLevel(value)}
            />
          </ObsidianSetting>
          <ObsidianSetting
            name="Include Thought Summaries"
            desc="Shows a summary of the model's reasoning process. Enabling this can increase token usage."
          >
            <ObsidianToggle
              value={includeThoughts}
              onChange={(value: boolean) => setIncludeThoughts(value)}
            />
          </ObsidianSetting>

          <ObsidianSetting>
            <ObsidianButton text="Save" onClick={handleSubmit} cta />
            <ObsidianButton text="Cancel" onClick={onClose} />
          </ObsidianSetting>
        </>
      )
    },
  },

  // Settings of providers whose API does not report a context window
  {
    check: (model) =>
      MANUAL_CONTEXT_WINDOW_PROVIDERS.includes(model.providerType),

    SettingsComponent: (props: SettingsComponentProps) => {
      const { model, plugin, onClose } = props
      const typedModel = model as ChatModel & {
        providerType:
          | 'perplexity'
          | 'ollama'
          | 'lm-studio'
          | 'azure-openai'
          | 'openai-compatible'
      }
      const hasSearchContext =
        typedModel.providerType === 'perplexity' &&
        [
          'sonar',
          'sonar-pro',
          'sonar-deep-research',
          'sonar-reasoning',
          'sonar-reasoning-pro',
        ].includes(typedModel.model)
      const [searchContextSize, setSearchContextSize] = useState(
        (typedModel.providerType === 'perplexity'
          ? typedModel.web_search_options?.search_context_size
          : undefined) ?? 'low',
      )
      const [contextWindow, setContextWindow] = useState(
        String(typedModel.contextWindow ?? ''),
      )

      const handleSubmit = async () => {
        if (!['low', 'medium', 'high'].includes(searchContextSize)) {
          new Notice(
            'Search context size must be one of "low", "medium", "high"',
          )
          return
        }
        const parsedContextWindow = parseContextWindow(contextWindow)
        if (contextWindow !== '' && !parsedContextWindow) {
          new Notice('Context window must be a positive integer')
          return
        }

        const updatedModel = {
          ...typedModel,
          ...(typedModel.providerType === 'perplexity' &&
            hasSearchContext && {
              web_search_options: {
                ...typedModel.web_search_options,
                search_context_size: searchContextSize,
              },
            }),
          contextWindow: parsedContextWindow,
        }

        const validationResult = chatModelSchema.safeParse(updatedModel)
        if (!validationResult.success) {
          new Notice(
            validationResult.error.issues.map((v) => v.message).join('\n'),
          )
          return
        }

        await plugin.setSettings((current) => ({
          ...current,
          chatModels: current.chatModels.map((m) =>
            m.id === model.id ? updatedModel : m,
          ),
        }))
        onClose()
      }

      return (
        <>
          {hasSearchContext && (
            <ObsidianSetting
              name="Search Context Size"
              desc={`Determines how much search context is retrieved for the model. Choose "low" for minimal context and lower costs, "medium" for a balanced approach, or "high" for maximum context at higher cost. Default is "low".`}
            >
              <ObsidianDropdown
                value={searchContextSize}
                options={{
                  low: 'low',
                  medium: 'medium',
                  high: 'high',
                }}
                onChange={(value: string) => setSearchContextSize(value)}
              />
            </ObsidianSetting>
          )}

          <ContextWindowSetting
            value={contextWindow}
            onChange={setContextWindow}
          />

          <ObsidianSetting>
            <ObsidianButton text="Save" onClick={handleSubmit} cta />
            <ObsidianButton text="Cancel" onClick={onClose} />
          </ObsidianSetting>
        </>
      )
    },
  },
]

function getModelSettings(model: ChatModel): ModelSettingsRegistry | undefined {
  return MODEL_SETTINGS_REGISTRY.find((registry) => registry.check(model))
}

export function hasChatModelSettings(model: ChatModel): boolean {
  return !!getModelSettings(model)
}
