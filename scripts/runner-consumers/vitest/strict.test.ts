import { expect, it } from 'vitest'
import { useStrictMocks } from 'meocord/testing'
import { strictFieldGaps } from './shared/strict-fields.js'

useStrictMocks()

it('holds every property discord.js declares on a strict mock of its class, under vitest', () => {
  expect(strictFieldGaps()).toEqual({ missing: [], unread: [] })
})
