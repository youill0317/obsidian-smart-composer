import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { COMMAND_PRIORITY_LOW, PASTE_COMMAND, PasteCommandType } from 'lexical'
import { useEffect } from 'react'

export default function ImagePastePlugin({
  onUploadImages,
}: {
  onUploadImages?: (files: File[]) => void
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const handlePaste = (event: PasteCommandType) => {
      const clipboardData =
        event instanceof ClipboardEvent ? event.clipboardData : null
      if (!clipboardData) return false

      const images = Array.from(clipboardData.files).filter((file) =>
        file.type.startsWith('image/'),
      )
      if (images.length === 0) return false

      onUploadImages?.(images)
      return true
    }

    return editor.registerCommand(
      PASTE_COMMAND,
      handlePaste,
      COMMAND_PRIORITY_LOW,
    )
  }, [editor, onUploadImages])

  return null
}
