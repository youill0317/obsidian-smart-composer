import { usePlugin } from './plugin-context'

export function useTools() {
  return usePlugin().toolManager
}
