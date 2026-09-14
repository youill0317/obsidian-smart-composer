import {
  $createParagraphNode,
  $createTabNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'

import {
  sanitizeSerializedEditorState,
  sanitizeSerializedMentionable,
  sanitizeSerializedMentionables,
  sanitizeSerializedNodes,
} from './serialized-editor-state'

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo='

function editorStateWithMention(style = ''): unknown {
  return {
    root: {
      children: [
        {
          children: [
            {
              detail: 0,
              format: 0,
              mode: 'token',
              style,
              text: '@note.md',
              type: 'mention',
              version: 1,
              mentionName: 'note.md',
              mentionable: { type: 'file', file: 'note.md' },
            },
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'paragraph',
          version: 1,
          textFormat: 0,
          textStyle: '',
        },
      ],
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  }
}

describe('serialized editor state validation', () => {
  it('accepts the current Lexical editor export shape', () => {
    const editor = createEditor({
      onError: (error) => {
        throw error
      },
    })
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('ok')))
      },
      { discrete: true },
    )

    expect(
      sanitizeSerializedEditorState(editor.getEditorState().toJSON()),
    ).not.toBeNull()
  })

  it('accepts only the canonical built-in Lexical tab export', () => {
    const editor = createEditor({
      onError: (error) => {
        throw error
      },
    })
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTabNode()))
      },
      { discrete: true },
    )
    const exported = editor.getEditorState().toJSON()
    const exportedWithChildren = exported as unknown as {
      root: { children: { children: Record<string, unknown>[] }[] }
    }

    expect(
      exportedWithChildren.root.children[0].children.some(
        (node) => node.type === 'tab',
      ),
    ).toBe(true)
    expect(sanitizeSerializedEditorState(exported)).not.toBeNull()

    const malformed = structuredClone(exportedWithChildren)
    const tab = malformed.root.children[0].children[0]
    tab.detail = 0
    expect(sanitizeSerializedEditorState(malformed)).toBeNull()
  })

  it('strips serialized styles before Lexical parses mention nodes', () => {
    const state = sanitizeSerializedEditorState(
      editorStateWithMention('position:fixed;inset:0'),
    )
    expect(state).not.toBeNull()
    expect(
      (
        state as unknown as {
          root: { children: { children: { style: string }[] }[] }
        }
      ).root.children[0].children[0].style,
    ).toBe('')
  })

  it('rejects unregistered nodes and malformed mention payloads', () => {
    const state = editorStateWithMention() as {
      root: { children: { children: Record<string, unknown>[] }[] }
    }
    state.root.children[0].children[0].mentionable = {
      type: 'file',
      file: 42,
    }
    expect(sanitizeSerializedEditorState(state)).toBeNull()

    state.root.children[0].children[0] = { type: 'html', version: 1 }
    expect(sanitizeSerializedEditorState(state)).toBeNull()
  })

  it('rejects editor states that exceed the aggregate text limit', () => {
    const state = editorStateWithMention() as {
      root: { children: { children: Record<string, unknown>[] }[] }
    }
    state.root.children[0].children = new Array(6).fill(null).map(() => ({
      detail: 0,
      format: 0,
      mode: 'normal',
      style: '',
      text: 'a'.repeat(200_000),
      type: 'text',
      version: 1,
    }))

    expect(sanitizeSerializedEditorState(state)).toBeNull()
  })

  it('allows only HTTP URLs and bounds persisted image arrays', () => {
    expect(
      sanitizeSerializedMentionable({ type: 'url', url: 'file:///secret' }),
    ).toBeNull()

    const image = {
      type: 'image',
      name: 'pixel.png',
      mimeType: 'image/png',
      data: PNG_DATA_URL,
    }
    expect(
      sanitizeSerializedMentionables(new Array(5).fill(image)),
    ).not.toBeNull()
    expect(sanitizeSerializedMentionables(new Array(6).fill(image))).toBeNull()

    const url = { type: 'url', url: 'https://example.com' }
    expect(
      sanitizeSerializedMentionables(new Array(10).fill(url)),
    ).not.toBeNull()
    expect(sanitizeSerializedMentionables(new Array(11).fill(url))).toBeNull()
  })

  it('bounds URL mention nodes in editor and template content', () => {
    const state = editorStateWithMention() as {
      root: { children: { children: Record<string, unknown>[] }[] }
    }
    state.root.children[0].children = new Array(11).fill(null).map(() => ({
      detail: 0,
      format: 0,
      mode: 'token',
      style: '',
      text: '@https://example.com',
      type: 'mention',
      version: 1,
      mentionName: 'https://example.com',
      mentionable: { type: 'url', url: 'https://example.com' },
    }))

    expect(sanitizeSerializedEditorState(state)).toBeNull()
    expect(sanitizeSerializedNodes(state.root.children[0].children)).toBeNull()
  })
})
