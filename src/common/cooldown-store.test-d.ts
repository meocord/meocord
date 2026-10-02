import { describe, expectTypeOf, it } from 'vitest'
import { MemoryCooldownStore } from '@src/common/index.js'

describe('MemoryCooldownStore', () => {
  it('keeps how it holds and sweeps its keys to itself', () => {
    expectTypeOf<MemoryCooldownStore>().not.toHaveProperty('size')
    expectTypeOf<MemoryCooldownStore>().not.toHaveProperty('sweep')
  })
})
