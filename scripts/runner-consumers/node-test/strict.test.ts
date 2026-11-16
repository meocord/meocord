import assert from 'node:assert/strict'
import { it } from 'node:test'
import { useStrictMocks } from 'meocord/testing'
import { strictFieldGaps } from './shared/strict-fields.js'

useStrictMocks()

it('holds every property discord.js declares on a strict mock of its class, under node:test', () => {
  assert.deepEqual(strictFieldGaps(), { missing: [], unread: [] })
})
