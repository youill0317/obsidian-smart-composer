import { TextComponent, setTooltip } from 'obsidian'
import { useEffect, useRef, useState } from 'react'

import { useObsidianSetting } from './ObsidianSetting'

type ObsidianTextInputProps = {
  value: string
  placeholder?: string
  onChange: (value: string) => void
  type?: 'text' | 'number' | 'password'
  disabled?: boolean
  tooltip?: string
}

export function ObsidianTextInput({
  value,
  placeholder,
  onChange,
  type,
  disabled,
  tooltip,
}: ObsidianTextInputProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { setting } = useObsidianSetting()
  const [textComponent, setTextComponent] = useState<TextComponent | null>(null)
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  // Set when a value change arrived while the user was typing.
  const skippedValueRef = useRef(false)

  useEffect(() => {
    if (setting) {
      let newTextComponent: TextComponent | null = null
      setting.addText((component) => {
        newTextComponent = component
      })
      setTextComponent(newTextComponent)

      return () => {
        newTextComponent?.inputEl.remove()
      }
    } else if (containerRef.current) {
      const newTextComponent = new TextComponent(containerRef.current)
      setTextComponent(newTextComponent)

      return () => {
        newTextComponent?.inputEl.remove()
      }
    }
  }, [setting])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!textComponent) return
    textComponent.onChange((v) => onChangeRef.current(v))
  }, [textComponent])

  useEffect(() => {
    if (!textComponent) return
    if (placeholder) textComponent.setPlaceholder(placeholder)
    if (type) textComponent.inputEl.type = type
  }, [textComponent, placeholder, type])

  useEffect(() => {
    valueRef.current = value
    if (!textComponent) return
    const input = textComponent.inputEl
    // A save that finishes while the user is still typing would replace newer
    // keystrokes, so the latest value is applied when the field loses focus.
    if (input.ownerDocument.activeElement === input) {
      skippedValueRef.current = true
      return
    }
    skippedValueRef.current = false
    textComponent.setValue(value)
  }, [textComponent, value])

  useEffect(() => {
    if (!textComponent) return
    const input = textComponent.inputEl
    const handleBlur = () => {
      if (!skippedValueRef.current) return
      skippedValueRef.current = false
      textComponent.setValue(valueRef.current)
    }
    input.addEventListener('blur', handleBlur)
    return () => input.removeEventListener('blur', handleBlur)
  }, [textComponent])

  useEffect(() => {
    if (!textComponent) return
    if (disabled !== undefined) textComponent.setDisabled(disabled)
    if (tooltip) setTooltip(textComponent.inputEl, tooltip)
  }, [textComponent, disabled, tooltip])

  return <div ref={containerRef} />
}
