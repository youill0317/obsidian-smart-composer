import { App, SecretComponent } from 'obsidian'
import { useEffect, useRef, useState } from 'react'

import { useObsidianSetting } from './ObsidianSetting'

type ObsidianSecretInputProps = {
  app: App
  value: string
  onChange: (value: string) => void
}

export function ObsidianSecretInput({
  app,
  value,
  onChange,
}: ObsidianSecretInputProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { setting } = useObsidianSetting()
  const [secretComponent, setSecretComponent] =
    useState<SecretComponent | null>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    const parentEl = setting?.controlEl ?? containerRef.current
    if (!parentEl) return
    const el = parentEl.createDiv()
    setSecretComponent(new SecretComponent(app, el))

    return () => {
      el.remove()
    }
  }, [app, setting])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!secretComponent) return
    secretComponent.onChange((v) => onChangeRef.current(v))
  }, [secretComponent])

  useEffect(() => {
    if (!secretComponent) return
    secretComponent.setValue(value)
  }, [secretComponent, value])

  return <div ref={containerRef} />
}
