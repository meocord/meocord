import { vi } from 'vitest'
import { READY_WAIT_INTERACTION_MS, ReadyGate, type ReadyWait, type ToldState } from '@src/core/ready-gate.js'
import { type Told } from '@src/common/response/response-state.js'
import { type LifecycleUnit } from '@src/core/lifecycle-order.js'

class Prefs {
  onReady(): void {}
}

class PrefsThemes {}

class Notes {}

const units: LifecycleUnit[] = [
  { token: Prefs, name: 'Prefs', dependencies: [] },
  { token: PrefsThemes, name: 'PrefsThemes', dependencies: [Prefs] },
  { token: Notes, name: 'Notes', dependencies: [Prefs] },
]

/** What Discord has been told of one interaction, set by the test. */
function toldState(told: Told): ToldState & { told: Told; tell(told: Told): void } {
  let changed = Promise.withResolvers<void>()
  const state = {
    told,
    toldChanged: () => changed.promise,
    tell(next: Told) {
      state.told = next
      changed.resolve()
      changed = Promise.withResolvers()
    },
  }
  return state
}

/** A gate, and what waits on it for one interaction: its call and theme lookups, each recording when it went on. */
function gateFor(told: ToldState) {
  const warn = vi.fn()
  const gate = new ReadyGate(units, warn, PrefsThemes)
  const interaction = {}
  const start = Date.now()
  const order: string[] = []
  const bound = { kind: 'interaction' as const, ms: READY_WAIT_INTERACTION_MS, since: start, told, of: interaction }
  const went = (name: string) => () => void order.push(`${name} @${Date.now() - start}`)
  const call: ReadyWait = { controller: Notes, methodName: 'note', classes: () => [Notes], bound }
  return {
    gate,
    warn,
    order,
    call: () => void gate.wait(call).then(went('call')),
    lookup: (name = 'lookup') => void gate.lookupReady(() => bound)!.then(went(name)),
  }
}

describe('the ready gate, for one interaction', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it.each(['the call', 'the lookup'] as const)(
    'lets its call and a theme lookup waiting at once go ahead together at its bound, %s waiting first, the call first and naming the hook',
    async first => {
      const { warn, order, call, lookup } = gateFor(toldState('nothing'))
      if (first === 'the call') call()
      lookup()
      if (first === 'the lookup') call()

      await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS - 1)
      expect(order).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(order).toEqual([`call @${READY_WAIT_INTERACTION_MS}`, `lookup @${READY_WAIT_INTERACTION_MS}`])
      expect(warn.mock.calls).toEqual([[expect.stringMatching(/^Notes\.note ran before onReady in Prefs had settled, 2\.0 s after/)]])
    },
  )

  it('holds its call and its lookups alike once Discord is told of an answer before the bound, without a warning', async () => {
    const told = toldState('nothing')
    const { gate, warn, order, call, lookup } = gateFor(told)
    call()
    lookup()
    await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS - 1)
    told.tell('told')
    await vi.advanceTimersByTimeAsync(2 * READY_WAIT_INTERACTION_MS)
    expect(order).toEqual([])

    units.forEach(unit => gate.settled(unit))
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toHaveLength(2)
    expect(warn).not.toHaveBeenCalled()
  })

  it('decides afresh for a lookup that starts after its call went ahead, which then waits for the hooks once Discord is told', async () => {
    const told = toldState('nothing')
    const { gate, warn, order, call, lookup } = gateFor(told)
    call()
    await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS)
    expect(order).toEqual([`call @${READY_WAIT_INTERACTION_MS}`])

    told.tell('told')
    lookup('later lookup')
    await vi.advanceTimersByTimeAsync(2 * READY_WAIT_INTERACTION_MS)
    expect(order).toEqual([`call @${READY_WAIT_INTERACTION_MS}`])

    units.forEach(unit => gate.settled(unit))
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual([`call @${READY_WAIT_INTERACTION_MS}`, `later lookup @${3 * READY_WAIT_INTERACTION_MS}`])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('clears its bound once the hooks release everything waiting on it, leaving no timer and no warning', async () => {
    const { gate, warn, order, call, lookup } = gateFor(toldState('nothing'))
    call()
    lookup()
    await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS / 2)
    expect(vi.getTimerCount()).toBe(1)

    units.forEach(unit => gate.settled(unit))
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it('lets a lookup made outside a call wait for the hooks once Discord has an answer', async () => {
    const { gate, warn, order, lookup } = gateFor(toldState('told'))
    lookup()
    await vi.advanceTimersByTimeAsync(2 * READY_WAIT_INTERACTION_MS)
    expect(order).toEqual([])

    units.forEach(unit => gate.settled(unit))
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual([`lookup @${2 * READY_WAIT_INTERACTION_MS}`])
    expect(warn).not.toHaveBeenCalled()
  })
})
