import { createEditor } from 'lexical'

import { MentionNode, SerializedMentionNode } from './MentionNode'

it('ignores stored inline styles and has no HTML import', () => {
  expect(Object.prototype.hasOwnProperty.call(MentionNode, 'importDOM')).toBe(
    false,
  )
  const editor = createEditor({ nodes: [MentionNode] })
  let style: string | undefined
  editor.update(
    () => {
      const node = MentionNode.importJSON({
        type: 'mention',
        version: 1,
        text: '@note',
        mentionName: 'note',
        mentionable: { type: 'file', file: 'note.md' },
        format: 0,
        detail: 0,
        mode: 'token',
        style: 'position:fixed;inset:0',
      } as SerializedMentionNode)
      style = node.getStyle()
    },
    { discrete: true },
  )
  expect(style).toBe('')
})
