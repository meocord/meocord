import { describe, expectTypeOf, it } from 'vitest'
import { permissionNames } from '@src/common/index.js'

describe('permissionNames', () => {
  it('gives a label per bit, or one string with join', () => {
    expectTypeOf(permissionNames(['KickMembers'])).toEqualTypeOf<string[]>()
    expectTypeOf(permissionNames(['KickMembers'], 'ja')).toEqualTypeOf<string[]>()
    expectTypeOf(permissionNames(['KickMembers'], undefined, { join: 'and' })).toEqualTypeOf<string>()
    // @ts-expect-error a join it can't write
    permissionNames(['KickMembers'], undefined, { join: 'nor' })
  })
})
