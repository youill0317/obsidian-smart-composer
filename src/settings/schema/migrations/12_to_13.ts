import { DEFAULT_SEARCH_ENGINES_CONFIG } from '../../../types/search.types'

export function migrateFrom12To13(
    data: Record<string, unknown>,
): Record<string, unknown> {
    return {
        ...data,
        version: 13,
        searchEngines: DEFAULT_SEARCH_ENGINES_CONFIG,
    }
}
