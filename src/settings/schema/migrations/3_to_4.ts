import { PROVIDER_TYPES_INFO } from '../../../constants'
import { SettingMigration } from '../setting.types'

export const migrateFrom3To4: SettingMigration['migrate'] = (data) => {
  const newData = { ...data }
  newData.version = 4

  // Handle chat models migration
  if ('chatModels' in newData && Array.isArray(newData.chatModels)) {
    const existingModelsMap = new Map(
      newData.chatModels.map((model) => [model.id, model]),
    )

    let newModel = {
      providerType: 'anthropic',
      providerId: PROVIDER_TYPES_INFO.anthropic.defaultProviderId,
      id: 'claude-3.7-sonnet',
      model: 'claude-3-7-sonnet-latest',
    }

    // Update only the known Anthropic routing. A colliding custom id remains
    // selected and keeps its original endpoint and credentials.
    const existingModel = existingModelsMap.get(newModel.id)
    if (
      existingModel &&
      existingModel.providerType === newModel.providerType &&
      existingModel.providerId === newModel.providerId
    ) {
      // keep the existing model settings
      newModel = Object.assign(existingModel, newModel)
      // Remove the existing model from the array
      newData.chatModels = newData.chatModels.filter(
        (model) => model.id !== newModel.id,
      )
      ;(newData.chatModels as unknown[]).splice(0, 0, newModel)
    } else if (!existingModel) {
      // Add the new model at index 0 of the array
      ;(newData.chatModels as unknown[]).splice(0, 0, newModel)
    }
  }
  return newData
}
