import React, { useEffect, useMemo, useState } from 'react'

import {
  SettingsSetter,
  SmartComposerSettings,
} from '../settings/schema/setting.types'

type SettingsContextType = {
  settings: SmartComposerSettings
  setSettings: SettingsSetter
}

// Settings context
const SettingsContext = React.createContext<SettingsContextType | undefined>(
  undefined,
)

export const SettingsProvider = ({
  children,
  settings: initialSettings,
  setSettings,
  addSettingsChangeListener,
}: {
  children: React.ReactNode
  settings: SmartComposerSettings
  setSettings: SettingsSetter
  addSettingsChangeListener: (
    listener: (newSettings: SmartComposerSettings) => void,
  ) => () => void
}) => {
  const [settingsCached, setSettingsCached] = useState(initialSettings)

  useEffect(() => {
    const removeListener = addSettingsChangeListener((newSettings) => {
      setSettingsCached(newSettings)
    })

    return () => {
      removeListener()
    }
  }, [addSettingsChangeListener, setSettings])

  const value = useMemo(
    () => ({ settings: settingsCached, setSettings }),
    [settingsCached, setSettings],
  )

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}

export const useSettings = () => {
  const settings = React.useContext(SettingsContext)
  if (!settings) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return settings
}
