import { SerializedEditorState, SerializedLexicalNode } from 'lexical'

import { SerializedMentionable } from '../../types/mentionable'
import { MAX_URL_ATTACHMENTS } from '../fetch-utils'
import {
  MAX_IMAGE_COUNT,
  MAX_TOTAL_IMAGE_BYTES,
  imageDataUrlByteLength,
  isSafeImageDataUrl,
} from '../llm/image'

const MAX_NODES = 1000
const MAX_TEXT_LENGTH = 200_000
const MAX_TOTAL_TEXT_LENGTH = 1024 * 1024
const MAX_NODE_DEPTH = 3
const MAX_PATH_LENGTH = 1024
const MAX_URL_LENGTH = 2048

type JsonObject = Record<string, unknown>
type ValidationCounter = {
  nodes: number
  imageCount: number
  imageBytes: number
  textLength: number
  urlCount: number
}

export function sanitizeSerializedEditorState(
  value: unknown,
): SerializedEditorState | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['root'])) return null
  const counter = createCounter()
  const root = sanitizeNode(value.root, counter, true, 0)
  return root?.type === 'root'
    ? ({ root } as unknown as SerializedEditorState)
    : null
}

export function sanitizeSerializedNodes(
  value: unknown,
): SerializedLexicalNode[] | null {
  if (!Array.isArray(value) || value.length > MAX_NODES) return null
  const counter = createCounter()
  const nodes = value.map((node) => sanitizeNode(node, counter, false, 0))
  return nodes.every((node): node is SerializedLexicalNode => node !== null)
    ? nodes
    : null
}

export function sanitizeSerializedMentionable(
  value: unknown,
): SerializedMentionable | null {
  if (!isObject(value) || typeof value.type !== 'string') return null

  switch (value.type) {
    case 'file':
      return hasOnlyKeys(value, ['type', 'file']) && isPath(value.file)
        ? { type: 'file', file: value.file }
        : null
    case 'folder':
      return hasOnlyKeys(value, ['type', 'folder']) && isPath(value.folder)
        ? { type: 'folder', folder: value.folder }
        : null
    case 'vault':
      return hasOnlyKeys(value, ['type']) ? { type: 'vault' } : null
    case 'current-file':
      return hasOnlyKeys(value, ['type', 'file']) &&
        (value.file === null || isPath(value.file))
        ? { type: 'current-file', file: value.file }
        : null
    case 'block':
      return hasOnlyKeys(value, [
        'type',
        'content',
        'file',
        'startLine',
        'endLine',
      ]) &&
        typeof value.content === 'string' &&
        value.content.length <= MAX_TEXT_LENGTH &&
        isPath(value.file) &&
        isPositiveInteger(value.startLine) &&
        isPositiveInteger(value.endLine) &&
        value.startLine <= value.endLine
        ? {
            type: 'block',
            content: value.content,
            file: value.file,
            startLine: value.startLine,
            endLine: value.endLine,
          }
        : null
    case 'url':
      return hasOnlyKeys(value, ['type', 'url']) && isHttpUrl(value.url)
        ? { type: 'url', url: value.url }
        : null
    case 'image':
      return hasOnlyKeys(value, ['type', 'name', 'mimeType', 'data']) &&
        typeof value.name === 'string' &&
        value.name.length <= 255 &&
        typeof value.mimeType === 'string' &&
        typeof value.data === 'string' &&
        value.data.startsWith(`data:${value.mimeType};base64,`) &&
        isSafeImageDataUrl(value.data)
        ? {
            type: 'image',
            name: value.name,
            mimeType: value.mimeType,
            data: value.data,
          }
        : null
    default:
      return null
  }
}

export function sanitizeSerializedMentionables(
  value: unknown,
): SerializedMentionable[] | null {
  if (!Array.isArray(value) || value.length > MAX_NODES) return null
  const mentionables = value.map(sanitizeSerializedMentionable)
  if (mentionables.some((mentionable) => mentionable === null)) return null

  const images = mentionables.filter(
    (
      mentionable,
    ): mentionable is Extract<SerializedMentionable, { type: 'image' }> =>
      mentionable?.type === 'image',
  )
  const totalBytes = images.reduce(
    (total, image) => total + imageDataUrlByteLength(image.data),
    0,
  )
  const urlCount = mentionables.filter(
    (mentionable) => mentionable?.type === 'url',
  ).length
  return images.length <= MAX_IMAGE_COUNT &&
    totalBytes <= MAX_TOTAL_IMAGE_BYTES &&
    urlCount <= MAX_URL_ATTACHMENTS
    ? (mentionables as SerializedMentionable[])
    : null
}

function sanitizeNode(
  value: unknown,
  counter: ValidationCounter,
  expectRoot: boolean,
  depth: number,
): SerializedLexicalNode | null {
  if (
    !isObject(value) ||
    ++counter.nodes > MAX_NODES ||
    depth > MAX_NODE_DEPTH
  ) {
    return null
  }
  if (typeof value.type !== 'string' || value.version !== 1) return null

  if (value.type === 'root' || value.type === 'paragraph') {
    if (
      (value.type === 'root') !== expectRoot ||
      !Array.isArray(value.children)
    ) {
      return null
    }
    if (value.children.length > MAX_NODES - counter.nodes) return null
    const allowedKeys =
      value.type === 'root'
        ? ['children', 'direction', 'format', 'indent', 'type', 'version']
        : [
            'children',
            'direction',
            'format',
            'indent',
            'type',
            'version',
            'textFormat',
            'textStyle',
          ]
    if (
      !hasOnlyKeys(value, allowedKeys) ||
      !isDirection(value.direction) ||
      (typeof value.format !== 'string' && typeof value.format !== 'number') ||
      !isNonNegativeInteger(value.indent)
    ) {
      return null
    }
    const children = value.children.map((child) =>
      sanitizeNode(child, counter, false, depth + 1),
    )
    if (children.some((child) => child === null)) return null
    if (
      value.type === 'root'
        ? children.some((child) => child?.type !== 'paragraph')
        : children.some(
            (child) => child?.type === 'paragraph' || child?.type === 'root',
          )
    ) {
      return null
    }

    return {
      children,
      direction: value.direction,
      format: value.format,
      indent: value.indent,
      type: value.type,
      version: 1,
      ...(value.type === 'paragraph'
        ? {
            textFormat: isNonNegativeInteger(value.textFormat)
              ? value.textFormat
              : 0,
            textStyle: '',
          }
        : {}),
    } as SerializedLexicalNode
  }

  if (expectRoot) return null
  if (value.type === 'linebreak') {
    return hasOnlyKeys(value, ['type', 'version'])
      ? ({ type: 'linebreak', version: 1 } as SerializedLexicalNode)
      : null
  }

  const textKeys = [
    'detail',
    'format',
    'mode',
    'style',
    'text',
    'type',
    'version',
  ]
  if (
    value.type !== 'text' &&
    value.type !== 'mention' &&
    value.type !== 'tab'
  ) {
    return null
  }
  if (
    !hasOnlyKeys(
      value,
      value.type === 'mention'
        ? [...textKeys, 'mentionName', 'mentionable']
        : textKeys,
    ) ||
    !isNonNegativeInteger(value.detail) ||
    !isNonNegativeInteger(value.format) ||
    !['normal', 'token', 'segmented'].includes(String(value.mode)) ||
    typeof value.style !== 'string' ||
    typeof value.text !== 'string' ||
    value.text.length > MAX_TEXT_LENGTH
  ) {
    return null
  }

  if (value.type === 'tab') {
    if (
      value.detail !== 2 ||
      value.format !== 0 ||
      value.mode !== 'normal' ||
      value.style !== '' ||
      value.text !== '\t'
    ) {
      return null
    }
    counter.textLength += 1
    if (counter.textLength > MAX_TOTAL_TEXT_LENGTH) return null
    return {
      detail: 2,
      format: 0,
      mode: 'normal',
      style: '',
      text: '\t',
      type: 'tab',
      version: 1,
    } as SerializedLexicalNode
  }

  if (value.type === 'mention') {
    const mentionable = sanitizeSerializedMentionable(value.mentionable)
    if (
      !mentionable ||
      typeof value.mentionName !== 'string' ||
      value.mentionName.length > 2048
    ) {
      return null
    }
    if (mentionable.type === 'image') {
      counter.imageCount += 1
      counter.imageBytes += imageDataUrlByteLength(mentionable.data)
      if (
        counter.imageCount > MAX_IMAGE_COUNT ||
        counter.imageBytes > MAX_TOTAL_IMAGE_BYTES
      ) {
        return null
      }
    }
    if (mentionable.type === 'url') {
      counter.urlCount += 1
      if (counter.urlCount > MAX_URL_ATTACHMENTS) return null
    }
    counter.textLength +=
      value.mentionName.length +
      (mentionable.type === 'block' ? mentionable.content.length : 0)
    if (counter.textLength > MAX_TOTAL_TEXT_LENGTH) return null
    return {
      detail: 0,
      format: 0,
      mode: 'token',
      style: '',
      text: `@${value.mentionName}`,
      type: 'mention',
      version: 1,
      mentionName: value.mentionName,
      mentionable,
    } as SerializedLexicalNode
  }

  counter.textLength += value.text.length
  if (counter.textLength > MAX_TOTAL_TEXT_LENGTH) return null

  return {
    detail: value.detail,
    format: value.format,
    mode: value.mode,
    style: '',
    text: value.text,
    type: 'text',
    version: 1,
  } as SerializedLexicalNode
}

function createCounter(): ValidationCounter {
  return {
    nodes: 0,
    imageCount: 0,
    imageBytes: 0,
    textLength: 0,
    urlCount: 0,
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: JsonObject, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function isDirection(value: unknown): value is 'ltr' | 'rtl' | null {
  return value === 'ltr' || value === 'rtl' || value === null
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function isPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PATH_LENGTH &&
    !value.includes('\0')
  )
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return false
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
