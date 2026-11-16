import { expect, it } from '@jest/globals'
import { useStrictMocks } from 'meocord/testing'
import { strictFieldGaps } from './shared/strict-fields.js'

useStrictMocks()

it('holds every property discord.js declares on a strict mock of its class, under jest', () => {
  expect(strictFieldGaps()).toEqual({ missing: [], unread: [] })
})
