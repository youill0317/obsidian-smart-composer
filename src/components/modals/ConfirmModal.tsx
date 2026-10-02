import { App } from 'obsidian'

import { ReactModal } from '../common/ReactModal'

export type ConfirmModalOptions = {
  title: string
  message: string
  ctaText?: string
  onConfirm: () => void
  onCancel?: () => void
}

type ConfirmModalComponentProps = {
  message: string
  ctaText?: string
  onConfirm: () => void
  onCancel?: () => void
  onClose: () => void
}

export class ConfirmModal extends ReactModal<ConfirmModalComponentProps> {
  constructor(app: App, options: ConfirmModalOptions) {
    super({
      app: app,
      Component: ConfirmModalComponent,
      props: {
        message: options.message,
        ctaText: options.ctaText,
        onConfirm: options.onConfirm,
        onCancel: options.onCancel,
      },
      options: {
        title: options.title,
      },
    })
  }
}

/**
 * Opens a ConfirmModal and resolves to true when confirmed, false when
 * cancelled or dismissed (Esc, close button, clicking outside).
 */
export function confirmAsync(
  app: App,
  options: Omit<ConfirmModalOptions, 'onConfirm' | 'onCancel'>,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (value: boolean) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const modal = new ConfirmModal(app, {
      ...options,
      onConfirm: () => settle(true),
      onCancel: () => settle(false),
    })
    const onClose = modal.onClose.bind(modal)
    modal.onClose = () => {
      onClose()
      // The confirm button closes the modal before calling onConfirm.
      window.setTimeout(() => settle(false), 0)
    }
    modal.open()
  })
}

function ConfirmModalComponent({
  message,
  ctaText,
  onConfirm,
  onCancel,
  onClose,
}: ConfirmModalComponentProps) {
  return (
    <div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{message}</div>
      <div className="modal-button-container">
        <button
          className="mod-warning"
          onClick={() => {
            onClose()
            onConfirm()
          }}
        >
          {ctaText ?? 'Confirm'}
        </button>
        <button
          className="mod-cancel"
          onClick={() => {
            onClose()
            onCancel?.()
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
