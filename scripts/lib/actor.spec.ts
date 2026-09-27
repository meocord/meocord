import { describe, expect, it } from 'vitest'
import { actorLine } from './actor.js'

describe('actorLine', () => {
  const click = { event: 'actor', user: '100', what: 'e2e/fail', outcome: 'error' }

  it('says a call is the expected clicker’s', () => {
    expect(actorLine(click, '100')).toBe('   e2e/fail (error) by the expected clicker')
  })

  it('flags a call from anyone else', () => {
    expect(actorLine({ ...click, user: '200' }, '100')).toBe('   e2e/fail (error) by ANOTHER user, 200, not MEOCORD_E2E_CLICKER_ID')
  })

  it('shows the user when no clicker is set', () => {
    expect(actorLine(click, '')).toBe('   e2e/fail (error) by user 100')
  })

  it('says nothing for other markers', () => {
    expect(actorLine({ event: 'ready' }, '100')).toBeUndefined()
  })
})
