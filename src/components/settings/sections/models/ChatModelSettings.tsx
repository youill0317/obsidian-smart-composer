import { App, Notice } from 'obsidian'
import { useState } from 'react'

import SmartComposerPlugin from '../../../../main'
import { ChatModel, chatModelSchema } from '../../../../types/chat-model.types'
import { ObsidianButton } from '../../../common/ObsidianButton'
import { ObsidianDropdown } from '../../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../../common/ObsidianSetting'
import { ObsidianTextInput } from '../../../common/ObsidianTextInput'
import { ObsidianToggle } from '../../../common/ObsidianToggle'
import { ReactModal } from '../../../common/ReactModal'

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

const REASONING_SUPPORTED_PROVIDERS = [
  'openai',
  'groq',
  'openrouter',
  'ollama',
  'lm-studio',
  'deepseek',
  'azure-openai',
  'openai-compatible',
]
const THINKING_SUPPORTED_PROVIDERS = [
  'anthropic',
  'openrouter',
  'ollama',
  'lm-studio',
  'openai-compatible',
]
const GEMINI_THINKING_SUPPORTED_PROVIDERS = ['gemini']

/**
 * Registry of available model settings.
 *
 * The check function is used to determine if the model settings should be displayed.
 * The SettingsComponent is the component that will be displayed when the model settings are opened.
 */
const MODEL_SETTINGS_REGISTRY: ModelSettingsRegistry[] = [
  {
    check: (model) =>
      REASONING_SUPPORTED_PROVIDERS.includes(model.providerType) ||
      THINKING_SUPPORTED_PROVIDERS.includes(model.providerType) ||
      GEMINI_THINKING_SUPPORTED_PROVIDERS.includes(model.providerType) ||
      (model.providerType === 'perplexity' && !!model.web_search_options),

    SettingsComponent: (props: SettingsComponentProps) => {
      const { model, plugin, onClose } = props

      const supportsReasoning = REASONING_SUPPORTED_PROVIDERS.includes(
        model.providerType,
      )
      const supportsThinking = THINKING_SUPPORTED_PROVIDERS.includes(
        model.providerType,
      )
      const supportsGeminiThinking = GEMINI_THINKING_SUPPORTED_PROVIDERS.includes(
        model.providerType,
      )

      // Reasoning state
      const [reasoningEnabled, setReasoningEnabled] = useState<boolean>(
        (model as any).reasoning?.enabled ?? false,
      )
      const [reasoningEffort, setReasoningEffort] = useState<string>(
        (model as any).reasoning?.reasoning_effort ?? 'medium',
      )

      // Thinking state
      const DEFAULT_THINKING_BUDGET_TOKENS = 8192
      const [thinkingEnabled, setThinkingEnabled] = useState<boolean>(
        (model as any).thinking?.enabled ?? false,
      )
      const [budgetTokens, setBudgetTokens] = useState(
        (
          (model as any).thinking?.budget_tokens ?? DEFAULT_THINKING_BUDGET_TOKENS
        ).toString(),
      )

      // Gemini Thinking state
      const [geminiThinkingEnabled, setGeminiThinkingEnabled] = useState<boolean>(
        !!(model as any).thinkingConfig,
      )
      const [includeThoughts, setIncludeThoughts] = useState<boolean>(
        (model as any).thinkingConfig?.includeThoughts ?? true,
      )
      const [thinkingLevel, setThinkingLevel] = useState<string>(
        (model as any).thinkingConfig?.thinkingLevel ?? 'medium',
      )

      // Perplexity state
      const [searchContextSize, setSearchContextSize] = useState(
        (model as any).web_search_options?.search_context_size ?? 'low',
      )

      const handleSubmit = async () => {
        const updatedModel = { ...model } as any

        if (supportsReasoning) {
          if (!['low', 'medium', 'high'].includes(reasoningEffort)) {
            new Notice('Reasoning effort must be one of "low", "medium", "high"')
            return
          }
          updatedModel.reasoning = {
            enabled: reasoningEnabled,
            reasoning_effort: reasoningEffort,
          }
        }

        if (supportsThinking) {
          const parsedTokens = parseInt(budgetTokens, 10)
          if (isNaN(parsedTokens)) {
            new Notice('Please enter a valid number for budget tokens')
            return
          }
          if (parsedTokens < 1024) {
            new Notice('Budget tokens must be at least 1024')
            return
          }
          updatedModel.thinking = {
            enabled: thinkingEnabled,
            budget_tokens: parsedTokens,
          }
        }

        if (supportsGeminiThinking) {
          if (geminiThinkingEnabled) {
            updatedModel.thinkingConfig = {
              includeThoughts,
              thinkingLevel,
            }
          } else {
            delete updatedModel.thinkingConfig
          }
        }

        if (model.providerType === 'perplexity' && model.web_search_options) {
          updatedModel.web_search_options = {
            ...model.web_search_options,
            search_context_size: searchContextSize,
          }
        }

        const validationResult = chatModelSchema.safeParse(updatedModel)
        if (!validationResult.success) {
          new Notice(
            validationResult.error.issues.map((v) => v.message).join('\n'),
          )
          return
        }

        await plugin.setSettings({
          ...plugin.settings,
          chatModels: plugin.settings.chatModels.map((m) =>
            m.id === model.id ? updatedModel : m,
          ),
        })
        onClose()
      }

      return (
        <>
          {supportsReasoning && (
            <>
              <ObsidianSetting
                name="Reasoning"
                desc="Enable reasoning for the model. Available for o-series models (e.g., o3, o4-mini) and GPT-5 models."
              >
                <ObsidianToggle
                  value={reasoningEnabled}
                  onChange={(value: boolean) => setReasoningEnabled(value)}
                />
              </ObsidianSetting>
              {reasoningEnabled && (
                <ObsidianSetting
                  name="Reasoning Effort"
                  desc={`Controls how much thinking the model does before responding. Default is "medium".`}
                  className="smtcmp-setting-item--nested"
                  required
                >
                  <ObsidianDropdown
                    value={reasoningEffort}
                    options={{
                      low: 'low',
                      medium: 'medium',
                      high: 'high',
                    }}
                    onChange={(value: string) => setReasoningEffort(value)}
                  />
                </ObsidianSetting>
              )}
            </>
          )}

          {supportsThinking && (
            <>
              <ObsidianSetting
                name="Extended Thinking"
                desc="Enable extended thinking for Claude. Available for Claude Sonnet 3.7+ and Claude Opus 4.0+."
              >
                <ObsidianToggle
                  value={thinkingEnabled}
                  onChange={(value: boolean) => setThinkingEnabled(value)}
                />
              </ObsidianSetting>
              {thinkingEnabled && (
                <ObsidianSetting
                  name="Budget Tokens"
                  desc="The maximum number of tokens that Claude can use for thinking. Must be at least 1024."
                  className="smtcmp-setting-item--nested"
                  required
                >
                  <ObsidianTextInput
                    value={budgetTokens}
                    placeholder="Number of tokens"
                    onChange={(value: string) => setBudgetTokens(value)}
                    type="number"
                  />
                </ObsidianSetting>
              )}
            </>
          )}

          {supportsGeminiThinking && (
            <>
              <ObsidianSetting
                name="Thinking"
                desc="Enable thinking for Gemini 3 models."
              >
                <ObsidianToggle
                  value={geminiThinkingEnabled}
                  onChange={(value: boolean) => setGeminiThinkingEnabled(value)}
                />
              </ObsidianSetting>
              {geminiThinkingEnabled && (
                <>
                  <ObsidianSetting
                    name="Include Thoughts"
                    desc="Whether to include the model's thoughts in the response."
                    className="smtcmp-setting-item--nested"
                  >
                    <ObsidianToggle
                      value={includeThoughts}
                      onChange={(value: boolean) => setIncludeThoughts(value)}
                    />
                  </ObsidianSetting>
                  <ObsidianSetting
                    name="Thinking Level"
                    desc="Controls the depth of thinking. Available levels depend on the model (Flash: minimal, low, medium, high; Pro: low, high)."
                    className="smtcmp-setting-item--nested"
                    required
                  >
                    <ObsidianDropdown
                      value={thinkingLevel}
                      options={{
                        minimal: 'minimal',
                        low: 'low',
                        medium: 'medium',
                        high: 'high',
                      }}
                      onChange={(value: string) => setThinkingLevel(value)}
                    />
                  </ObsidianSetting>
                </>
              )}
            </>
          )}

          {model.providerType === 'perplexity' && model.web_search_options && (
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
