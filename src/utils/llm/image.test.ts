import { Notice } from 'obsidian'

import { filesToMentionableImages } from './image'

jest.mock('obsidian', () => ({ Notice: jest.fn() }))

it('skips images larger than 20 MB before reading them', async () => {
  const big = { size: 21 * 1024 * 1024, name: 'big.png', type: 'image/png' }
  await expect(filesToMentionableImages([big as File])).resolves.toEqual([])
  expect(Notice).toHaveBeenCalled()
})
