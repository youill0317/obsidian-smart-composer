import { App } from 'obsidian'

import SmartComposerPlugin from '../../main'

import { ChatSection } from './sections/ChatSection'
import { CliSection } from './sections/CliSection'
import { EtcSection } from './sections/EtcSection'
import { McpSection } from './sections/McpSection'
import { ModelsSection } from './sections/ModelsSection'
import { OcrSection } from './sections/OcrSection'
import { PlanConnectionsSection } from './sections/PlanConnectionsSection'
import { ProvidersSection } from './sections/ProvidersSection'
import { RAGSection } from './sections/RAGSection'
import { TemplateSection } from './sections/TemplateSection'

type SettingsTabRootProps = {
  app: App
  plugin: SmartComposerPlugin
}

export function SettingsTabRoot({ app, plugin }: SettingsTabRootProps) {
  return (
    <>
      <PlanConnectionsSection app={app} plugin={plugin} />
      <ChatSection />
      <ProvidersSection app={app} plugin={plugin} />
      <ModelsSection app={app} plugin={plugin} />
      <RAGSection app={app} plugin={plugin} />
      <OcrSection />
      <McpSection app={app} plugin={plugin} />
      <CliSection app={app} plugin={plugin} />
      <TemplateSection app={app} />
      <EtcSection app={app} plugin={plugin} />
    </>
  )
}
