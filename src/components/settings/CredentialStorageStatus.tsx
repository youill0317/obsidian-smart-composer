import SmartComposerPlugin from '../../main'

export function CredentialStorageStatus({
  plugin,
  providerId,
}: {
  plugin: SmartComposerPlugin
  providerId: string
}) {
  const status = plugin.getCredentialStatus(providerId)
  return (
    <div className="setting-item-description" title={status.detail}>
      {status.label}
      {(status.label === 'Session only' ||
        status.label === 'Needs attention') && <div>{status.detail}</div>}
    </div>
  )
}
