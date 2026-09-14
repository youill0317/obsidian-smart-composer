import { escapeLikePattern } from './VectorRepository'

describe('VectorRepository scope patterns', () => {
  it('escapes SQL LIKE wildcards in literal folder paths', () => {
    expect(escapeLikePattern('notes_100%\\drafts')).toBe(
      'notes\\_100\\%\\\\drafts',
    )
  })
})
