/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license.
 * Original source: https://github.com/facebook/lexical
 *
 * Modified from the original code
 */

import {
  $applyNodeReplacement,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
  TextNode,
} from 'lexical'

import { SerializedMentionable } from '../../../../../types/mentionable'
import { sanitizeSerializedMentionable } from '../../../../../utils/chat/serialized-editor-state'

export const MENTION_NODE_TYPE = 'mention'
export const MENTION_NODE_ATTRIBUTE = 'data-lexical-mention'
export const MENTION_NODE_MENTION_NAME_ATTRIBUTE = 'data-lexical-mention-name'
export const MENTION_NODE_MENTIONABLE_ATTRIBUTE = 'data-lexical-mentionable'
const MENTION_NODE_PROVENANCE_ATTRIBUTE = 'data-smtcmp-mention-provenance'
const mentionPasteProvenance = createPasteProvenance()

export type SerializedMentionNode = Spread<
  {
    mentionName: string
    mentionable: SerializedMentionable
  },
  SerializedTextNode
>

function $convertMentionElement(
  domNode: HTMLElement,
): DOMConversionOutput | null {
  if (
    domNode.getAttribute(MENTION_NODE_PROVENANCE_ATTRIBUTE) !==
    mentionPasteProvenance
  ) {
    return null
  }
  const textContent = domNode.textContent
  const mentionName =
    domNode.getAttribute(MENTION_NODE_MENTION_NAME_ATTRIBUTE) ??
    domNode.textContent ??
    ''
  let mentionable: SerializedMentionable | null = null
  try {
    mentionable = sanitizeSerializedMentionable(
      JSON.parse(
        domNode.getAttribute(MENTION_NODE_MENTIONABLE_ATTRIBUTE) ?? '{}',
      ),
    )
  } catch {
    return null
  }

  if (textContent !== null && mentionable) {
    const node = $createMentionNode(mentionName, mentionable)
    return {
      node,
    }
  }

  return null
}

export class MentionNode extends TextNode {
  __mentionName: string
  __mentionable: SerializedMentionable

  static getType(): string {
    return MENTION_NODE_TYPE
  }

  static clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__mentionName, node.__mentionable, node.__key)
  }
  static importJSON(serializedNode: SerializedMentionNode): MentionNode {
    const node = $createMentionNode(
      serializedNode.mentionName,
      serializedNode.mentionable,
    )
    node.setTextContent(serializedNode.text)
    node.setFormat(0)
    node.setDetail(0)
    node.setMode('token')
    node.setStyle('')
    return node
  }

  constructor(
    mentionName: string,
    mentionable: SerializedMentionable,
    key?: NodeKey,
  ) {
    super(`@${mentionName}`, key)
    this.__mentionName = mentionName
    this.__mentionable = mentionable
  }

  exportJSON(): SerializedMentionNode {
    return {
      ...super.exportJSON(),
      mentionName: this.__mentionName,
      mentionable: this.__mentionable,
      type: MENTION_NODE_TYPE,
      version: 1,
    }
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config)
    dom.className = MENTION_NODE_TYPE
    return dom
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('span')
    element.setAttribute(MENTION_NODE_ATTRIBUTE, 'true')
    element.setAttribute(
      MENTION_NODE_MENTION_NAME_ATTRIBUTE,
      this.__mentionName,
    )
    element.setAttribute(
      MENTION_NODE_MENTIONABLE_ATTRIBUTE,
      JSON.stringify(this.__mentionable),
    )
    element.setAttribute(
      MENTION_NODE_PROVENANCE_ATTRIBUTE,
      mentionPasteProvenance,
    )
    element.textContent = this.__text
    return { element }
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (
          !domNode.hasAttribute(MENTION_NODE_ATTRIBUTE) ||
          !domNode.hasAttribute(MENTION_NODE_MENTION_NAME_ATTRIBUTE) ||
          !domNode.hasAttribute(MENTION_NODE_MENTIONABLE_ATTRIBUTE)
        ) {
          return null
        }
        return {
          conversion: $convertMentionElement,
          priority: 1,
        }
      },
    }
  }

  isTextEntity(): true {
    return true
  }

  canInsertTextBefore(): boolean {
    return false
  }

  canInsertTextAfter(): boolean {
    return false
  }

  getMentionable(): SerializedMentionable {
    return this.__mentionable
  }
}

function createPasteProvenance(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

export function $createMentionNode(
  mentionName: string,
  mentionable: SerializedMentionable,
): MentionNode {
  const mentionNode = new MentionNode(mentionName, mentionable)
  mentionNode.setMode('token').toggleDirectionless()
  return $applyNodeReplacement(mentionNode)
}

export function $isMentionNode(
  node: LexicalNode | null | undefined,
): node is MentionNode {
  return node instanceof MentionNode
}
