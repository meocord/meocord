import 'reflect-metadata'
import { resetAllMocks, useMockFn, useStrictMocks } from 'meocord/testing'
import { afterEach, vi } from 'vitest'

// meocord/testing makes its mocks with vi.fn, so Vitest's matchers, config and vi.mocked() treat them as its own
useMockFn(vi.fn)
// Mocks compute what discord.js computes, such as a message's editable or a member's kickable, rather than placeholders
useStrictMocks()
// Every test starts from meocord's mocks as they were created
afterEach(() => resetAllMocks())
