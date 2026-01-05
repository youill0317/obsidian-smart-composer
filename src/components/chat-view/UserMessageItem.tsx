import { SerializedEditorState } from 'lexical'

import { ChatUserMessage } from '../../types/chat'
import { Mentionable } from '../../types/mentionable'

import ChatUserInput, { ChatUserInputRef } from './chat-input/ChatUserInput'
import SimilaritySearchResults from './SimilaritySearchResults'

export type UserMessageItemProps = {
  message: ChatUserMessage
  chatUserInputRef: (ref: ChatUserInputRef | null) => void
  onInputChange: (content: SerializedEditorState) => void
  onSubmit: (content: SerializedEditorState, useVaultSearch?: boolean, useWebSearch?: boolean) => void
  onFocus: () => void
  onMentionablesChange: (mentionables: Mentionable[]) => void
  isWebSearchDisabled?: boolean
}

export default function UserMessageItem({
  message,
  chatUserInputRef,
  onInputChange,
  onSubmit,
  onFocus,
  onMentionablesChange,
  isWebSearchDisabled,
}: UserMessageItemProps) {
  return (
    <div className="smtcmp-chat-messages-user">
      <ChatUserInput
        ref={chatUserInputRef}
        initialSerializedEditorState={message.content}
        onChange={onInputChange}
        onSubmit={onSubmit}
        onFocus={onFocus}
        mentionables={message.mentionables}
        setMentionables={onMentionablesChange}
        isWebSearchDisabled={isWebSearchDisabled}
      />
      {message.similaritySearchResults && (
        <SimilaritySearchResults
          similaritySearchResults={message.similaritySearchResults}
        />
      )}
    </div>
  )
}
