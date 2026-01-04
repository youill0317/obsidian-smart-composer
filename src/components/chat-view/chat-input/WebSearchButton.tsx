import * as Tooltip from '@radix-ui/react-tooltip'
import { Globe, CornerDownLeftIcon, ChevronUp, Command } from 'lucide-react'
import { Platform } from 'obsidian'

interface WebSearchButtonProps {
    onClick: () => void
    disabled?: boolean
}

export function WebSearchButton({ onClick, disabled }: WebSearchButtonProps) {
    return (
        <>
            <Tooltip.Provider delayDuration={0}>
                <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                        <div
                            className={`smtcmp-chat-user-input-submit-button ${disabled ? 'smtcmp-chat-user-input-submit-button-disabled' : ''}`}
                            onClick={disabled ? undefined : onClick}
                        >
                            <div className="smtcmp-chat-user-input-submit-button-icons">
                                {Platform.isMacOS ? (
                                    <Command size={10} />
                                ) : (
                                    <ChevronUp size={12} />
                                )}
                                <Globe size={12} />
                                <CornerDownLeftIcon size={12} />
                            </div>
                            <div>Web Search</div>
                        </div>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                        <Tooltip.Content className="smtcmp-tooltip-content" sideOffset={5}>
                            {disabled
                                ? 'No search engines enabled. Configure in settings.'
                                : 'Search the web for answers'}
                        </Tooltip.Content>
                    </Tooltip.Portal>
                </Tooltip.Root>
            </Tooltip.Provider>
        </>
    )
}
