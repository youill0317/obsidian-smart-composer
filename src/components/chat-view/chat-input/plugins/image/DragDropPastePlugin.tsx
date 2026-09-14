import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { DRAG_DROP_PASTE } from '@lexical/rich-text'
import { COMMAND_PRIORITY_LOW } from 'lexical'
import { useEffect } from 'react'

export default function DragDropPaste({
  onUploadImages,
}: {
  onUploadImages?: (files: File[]) => void
}): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      DRAG_DROP_PASTE, // dispatched in RichTextPlugin
      (files) => {
        const images = files.filter((file) => file.type.startsWith('image/'))
        onUploadImages?.(images)
        return true
      },
      COMMAND_PRIORITY_LOW,
    )
  }, [editor, onUploadImages])

  return null
}
