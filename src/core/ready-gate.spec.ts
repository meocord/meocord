import { vi } from 'vitest'
import { READY_WAIT_INTERACTION_MS, ReadyGate, type ToldState } from '@src/core/ready-gate.js'
import { type LifecycleUnit } from '@src/core/lifecycle-order.js'

class Prefs {
  onReady(): void {}
}

class PrefsThemes {}

const units: LifecycleUnit[] = [
  { token: Prefs, name: 'Prefs', dependencies: [] },
  { token: PrefsThemes, name: 'PrefsThemes', dependencies: [Prefs] },
]

/** Discord has an answer from outside the call, so a lookup of its own has no bound left. */
const answered: ToldState = { told: 'told', toldChanged: () => new Promise<void>(() => undefined) }

/** Starts a theme lookup at the bound of a call that goes ahead at `aheadAt` ms, or never; reports when it settles. */
function lookup(aheadAt?: number) {
  const warn = vi.fn()
  const gate = new ReadyGate(units, warn, PrefsThemes)
  const ahead = aheadAt === undefined ? undefined : new Promise<void>(resolve => setTimeout(resolve, aheadAt))
  let settledAt: number | undefined
  const start = Date.now()
  void gate.lookupReady(() => ({ kind: 'interaction', ms: READY_WAIT_INTERACTION_MS, told: answered, ahead }))!.then(() => (settledAt = Date.now() - start))
  return { gate, warn, settledAt: () => settledAt }
}

describe('a theme lookup waiting at the ready gate', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('goes ahead with the call it belongs to, without a warning of its own, though Discord has an answer', async () => {
    const { warn, settledAt } = lookup(READY_WAIT_INTERACTION_MS)
    await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS - 1)
    expect(settledAt()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(settledAt()).toBe(READY_WAIT_INTERACTION_MS)
    expect(warn).not.toHaveBeenCalled()
  })

  it('made outside a call, waits for the hooks once Discord has an answer', async () => {
    const { gate, warn, settledAt } = lookup()
    await vi.advanceTimersByTimeAsync(2 * READY_WAIT_INTERACTION_MS)
    expect(settledAt()).toBeUndefined()
    units.forEach(unit => gate.settled(unit))
    await vi.advanceTimersByTimeAsync(0)
    expect(settledAt()).toBe(2 * READY_WAIT_INTERACTION_MS)
    expect(warn).not.toHaveBeenCalled()
  })
})
