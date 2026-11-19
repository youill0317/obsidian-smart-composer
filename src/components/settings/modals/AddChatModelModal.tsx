import { App, Notice } from 'obsidian'
import { useState } from 'react'

import { DEFAULT_PROVIDERS, PROVIDER_TYPES_INFO } from '../../../constants'
import { MANUAL_CONTEXT_WINDOW_PROVIDERS } from '../../../core/llm/modelCompatibility'
import SmartComposerPlugin from '../../../main'
import { ChatModel, chatModelSchema } from '../../../types/chat-model.types'
import { PromptLevel } from '../../../types/prompt-level.types'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { ReactModal } from '../../common/ReactModal'
import {
  ContextWindowSetting,
  parseContextWindow,
} from '../sections/models/ContextWindowSetting'

type AddChatModelModalComponentProps = {
  plugin: SmartComposerPlugin
  onClose: () => void
}

export class AddChatModelModal extends ReactModal<AddChatModelModalComponentProps> {
  constructor(app: App, plugin: SmartComposerPlugin) {
    super({
      app: app,
      Component: AddChatModelModalComponent,
      props: { plugin },
      options: {
        title: 'Add Custom Chat Model',
      },
    })
  }
}

function AddChatModelModalComponent({
  plugin,
  onClose,
}: AddChatModelModalComponentProps) {
  const [formData, setFormData] = useState<ChatModel>({
    providerId: DEFAULT_PROVIDERS[0].id,
    providerType: DEFAULT_PROVIDERS[0].type as ChatModel['providerType'],
    id: '',
    model: '',
    promptLevel: PromptLevel.Default,
  })
  const [contextWindow, setContextWindow] = useState('')
  const entersContextWindow = MANUAL_CONTEXT_WINDOW_PROVIDERS.includes(
    formData.providerType,
  )

  const handleSubmit = async () => {
    if (plugin.settings.chatModels.some((p) => p.id === formData.id)) {
      new Notice('Model with this ID already exists. Try a different ID.')
      return
    }

    if (
      !plugin.settings.providers.some(
        (provider) => provider.id === formData.providerId,
      )
    ) {
      new Notice('Provider with this ID does not exist')
      return
    }

    const parsedContextWindow = parseContextWindow(contextWindow)
    if (entersContextWindow && !parsedContextWindow) {
      new Notice('Context window must be a positive integer')
      return
    }

    const validationResult = chatModelSchema.safeParse(
      entersContextWindow
        ? { ...formData, contextWindow: parsedContextWindow }
        : formData,
    )
    if (!validationResult.success) {
      new Notice(validationResult.error.issues.map((v) => v.message).join('\n'))
      return
    }

    await plugin.setSettings((current) => ({
      ...current,
      chatModels: [...current.chatModels, validationResult.data],
    }))

    onClose()
  }

  return (
    <>
      <ObsidianSetting
        name="ID"
        desc="Choose an ID to identify this model in your settings. This is just for your reference."
        required
      >
        <ObsidianTextInput
          value={formData.id}
          placeholder="my-custom-model"
          onChange={(value: string) =>
            setFormData((prev) => ({ ...prev, id: value }))
          }
        />
      </ObsidianSetting>

      <ObsidianSetting name="Provider ID" required>
        <ObsidianDropdown
          value={formData.providerId}
          options={Object.fromEntries(
            plugin.settings.providers
              .filter(
                (provider) => PROVIDER_TYPES_INFO[provider.type].supportChat,
              )
              .map((provider) => [provider.id, provider.id]),
          )}
          onChange={(value: string) => {
            const provider = plugin.settings.providers.find(
              (p) => p.id === value,
            )
            if (!provider) {
              new Notice(`Provider with ID ${value} not found`)
              return
            }
            // Cast required because we're changing the discriminant field
            setFormData(
              (prev) =>
                ({
                  ...prev,
                  providerId: value,
                  providerType: provider.type,
                }) as ChatModel,
            )
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting name="Model Name" required>
        <ObsidianTextInput
          value={formData.model}
          placeholder="Enter the model name"
          onChange={(value: string) =>
            setFormData((prev) => ({ ...prev, model: value }))
          }
        />
      </ObsidianSetting>

      {entersContextWindow && (
        <ContextWindowSetting
          value={contextWindow}
          onChange={setContextWindow}
          required
        />
      )}

      <ObsidianSetting
        name="Prompt Level"
        desc={`Choose how complex the system prompt should be. Select "simple" for small models that ignore user questions and just repeat back instructions.`}
        required
      >
        <ObsidianDropdown
          value={(formData.promptLevel ?? PromptLevel.Default).toString()}
          options={{
            [PromptLevel.Default]: 'default',
            [PromptLevel.Simple]: 'simple',
          }}
          onChange={(value: string) =>
            setFormData((prev) => ({
              ...prev,
              promptLevel: Number(value) as PromptLevel,
            }))
          }
        />
      </ObsidianSetting>

      <ObsidianSetting>
        <ObsidianButton text="Add" onClick={handleSubmit} cta />
        <ObsidianButton text="Cancel" onClick={onClose} />
      </ObsidianSetting>
    </>
  )
}
