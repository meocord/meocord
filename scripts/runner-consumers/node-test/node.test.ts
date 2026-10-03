import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { clickGreet } from './shared/module.js'

describe('meocord/testing under node:test', () => {
  it("dispatches a mock interaction, and node:assert reads meocord's mocks through .mock.calls", async () => {
    const text = mock.fn(() => 'from node')
    const { click, outcome } = await clickGreet(text)

    assert.equal(outcome.ran, true)
    assert.equal(text.mock.callCount(), 1)
    assert.equal(click.update.mock.calls.length, 1)
    assert.equal((click.update.mock.calls[0][0] as { content?: string }).content, 'from node')
  })
})
