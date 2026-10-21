import { createContext, useContext, useEffect, useMemo } from 'react'

import { VectorManager } from '../database/modules/vector/VectorManager'

type DatabaseContextType = {
  getVectorManager: () => Promise<VectorManager>
}

const DatabaseContext = createContext<DatabaseContextType | null>(null)

export function DatabaseProvider({
  children,
  getVectorManager,
}: {
  children: React.ReactNode
  getVectorManager: () => Promise<VectorManager>
}) {
  useEffect(() => {
    // start initialization of vectorManager in the background
    getVectorManager().catch((error) =>
      console.error('Failed to initialize vector manager', error),
    )
  }, [getVectorManager])

  const value = useMemo(() => {
    return { getVectorManager }
  }, [getVectorManager])

  return (
    <DatabaseContext.Provider value={value}>
      {children}
    </DatabaseContext.Provider>
  )
}

export function useDatabase(): DatabaseContextType {
  const context = useContext(DatabaseContext)
  if (!context) {
    throw new Error('useDatabase must be used within a DatabaseProvider')
  }
  return context
}
