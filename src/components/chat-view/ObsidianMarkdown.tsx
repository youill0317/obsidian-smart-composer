import { Keymap } from 'obsidian'
import {
  Children,
  ComponentProps,
  MouseEvent,
  ReactElement,
  ReactNode,
  isValidElement,
  memo,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { useApp } from '../../contexts/app-context'
import { useDarkModeContext } from '../../contexts/dark-mode-context'

import { MemoizedSyntaxHighlighterWrapper } from './SyntaxHighlighterWrapper'

type ObsidianMarkdownProps = {
  content: string
  scale?: 'xs' | 'sm' | 'base'
}

type MarkdownAstNode = {
  type: string
  value?: string
  url?: string
  children?: MarkdownAstNode[]
}

const INTERNAL_LINK_PREFIX = '#smtcmp-internal-link='
const MAX_MARKDOWN_CHARS = 200_000

const ObsidianMarkdown = memo(function ObsidianMarkdown({
  content,
  scale = 'base',
}: ObsidianMarkdownProps) {
  const app = useApp()
  const sourcePath = app.workspace.getActiveFile()?.path ?? ''
  const truncated = content.length > MAX_MARKDOWN_CHARS
  const safeContent = truncated ? content.slice(0, MAX_MARKDOWN_CHARS) : content

  const MarkdownLink = ({ href, children, ...props }: ComponentProps<'a'>) => {
    const internalTarget = getInternalLinkTarget(href)
    const isExternal = !!href && /^(https?:|mailto:)/i.test(href)

    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      if (!href || isExternal || (href.startsWith('#') && !internalTarget)) {
        return
      }
      event.preventDefault()
      const relativeTarget = internalTarget ?? safelyDecodeUri(href)
      if (!relativeTarget) return
      app.workspace.openLinkText(
        relativeTarget,
        sourcePath,
        Keymap.isModEvent(event.nativeEvent),
      )
    }

    return (
      <a
        {...props}
        href={href}
        className={internalTarget ? 'internal-link' : props.className}
        onClick={handleClick}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        target={isExternal ? '_blank' : undefined}
      >
        {children}
      </a>
    )
  }

  return (
    <div
      className={`markdown-rendered smtcmp-markdown-rendered smtcmp-scale-${scale}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkObsidianLinks]}
        components={{
          a: MarkdownLink,
          img: ({ alt }) => (
            <span>[Image not loaded: {alt ?? 'untitled'}]</span>
          ),
          pre: SafePre,
        }}
      >
        {safeContent}
      </ReactMarkdown>
      {truncated && <p>Preview truncated after 200,000 characters.</p>}
    </div>
  )
})

function SafePre({ children }: ComponentProps<'pre'>) {
  const { isDarkMode } = useDarkModeContext()
  const child = Children.only(children)
  if (!isValidElement(child)) return <pre>{children}</pre>

  const element = child as ReactElement<{
    className?: string
    children?: ReactNode
  }>
  const language = element.props.className?.replace(/^language-/, '')
  return (
    <MemoizedSyntaxHighlighterWrapper
      isDarkMode={isDarkMode}
      language={language}
      hasFilename={false}
      wrapLines={!language || language === 'markdown'}
    >
      {String(element.props.children ?? '').replace(/\n$/, '')}
    </MemoizedSyntaxHighlighterWrapper>
  )
}

function remarkObsidianLinks() {
  return (tree: MarkdownAstNode) => transformWikilinks(tree)
}

function transformWikilinks(node: MarkdownAstNode) {
  if (!node.children || ['code', 'inlineCode', 'link'].includes(node.type)) {
    return
  }

  node.children = node.children.flatMap((child) => {
    if (child.type !== 'text' || typeof child.value !== 'string') {
      transformWikilinks(child)
      return child
    }

    const result: MarkdownAstNode[] = []
    const pattern = /!?\[\[([^\]\n]+)\]\]/g
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(child.value))) {
      if (match.index > lastIndex) {
        result.push({
          type: 'text',
          value: child.value.slice(lastIndex, match.index),
        })
      }
      const [target, alias] = match[1].split('|', 2)
      result.push(
        isSafeInternalTarget(target)
          ? {
              type: 'link',
              url: `${INTERNAL_LINK_PREFIX}${encodeURIComponent(target)}`,
              children: [{ type: 'text', value: alias ?? target }],
            }
          : { type: 'text', value: alias ?? target },
      )
      lastIndex = match.index + match[0].length
    }
    if (lastIndex === 0) return child
    if (lastIndex < child.value.length) {
      result.push({ type: 'text', value: child.value.slice(lastIndex) })
    }
    return result
  })
}

function isSafeInternalTarget(target: string): boolean {
  return (
    target.length > 0 &&
    target.length <= 1024 &&
    !/^[a-z][a-z\d+.-]*:/i.test(target)
  )
}

function safelyDecodeUri(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function getInternalLinkTarget(href: string | undefined): string | null {
  if (!href?.startsWith(INTERNAL_LINK_PREFIX)) return null
  try {
    return decodeURIComponent(href.slice(INTERNAL_LINK_PREFIX.length))
  } catch {
    return null
  }
}

function ObsidianCodeBlock({
  content,
  language,
  scale = 'sm',
}: {
  content: string
  language?: string
  scale?: 'xs' | 'sm' | 'base'
}) {
  return (
    <div className="smtcmp-obsidian-code-block">
      <ObsidianMarkdown
        content={`\`\`\`${language ?? ''}\n${content}\n\`\`\``}
        scale={scale}
      />
    </div>
  )
}

export { ObsidianCodeBlock, ObsidianMarkdown }
