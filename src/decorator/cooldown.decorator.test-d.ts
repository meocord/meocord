import { describe, expectTypeOf, it } from 'vitest'
import { type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js'
import { applyDecorators } from '@src/common/index.js'
import { Command, Cooldown, MeoCord, UseGuard } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type CooldownOptions, type CooldownStoreFailure, type GuardInterface } from '@src/interface/index.js'

/**
 * Runs under `vitest --typecheck`. The negative cases use `@ts-expect-error`,
 * which fails once the rejected form starts compiling.
 */

class Allow implements GuardInterface {
  canActivate() {
    return true
  }
}

describe('@Cooldown({ by })', () => {
  it('reads the params it declares, when the handler receives them', () => {
    class Controller {
      @Command('check-in/{ownerId}/{uid}', CommandType.BUTTON)
      @Cooldown({ seconds: 3600, by: (_context, { uid }: { uid: string }) => uid })
      async checkIn(_interaction: ButtonInteraction, _params: { ownerId: string; uid: string }) {
        void _params
      }

      // An explicit type argument types the params without annotating them
      @Command('claim/{uid}', CommandType.BUTTON)
      @Cooldown<{ uid: string }>({ seconds: 3600, per: 'global', by: (_context, { uid }) => uid })
      async claim(_interaction: ButtonInteraction, _params: { uid: string }) {
        void _params
      }

      @Command('shard', CommandType.SLASH)
      @Cooldown({ seconds: 60, by: async (_context, { shard }: { shard: number }) => (shard > 0 ? shard : undefined) })
      async shard(_interaction: ChatInputCommandInteraction, _params: { shard: number }) {
        void _params
      }
    }
    void Controller
  })

  it('compiles a by that reads one of several params', () => {
    class Controller {
      // Once an hour per user, for each game account the button checks in
      @Command('check-in/{ownerId}/{uid}', CommandType.BUTTON)
      @Cooldown({ seconds: 3600, by: (_context, { uid }: { uid: string }) => uid })
      async checkIn(interaction: ButtonInteraction, { uid }: { ownerId: string; uid: string }) {
        void interaction
        void uid
      }
    }
    void Controller
  })

  it('refuses a by that reads a param the handler does not receive', () => {
    class Controller {
      @Command('check-in/{ownerId}/{uid}', CommandType.BUTTON)
      // @ts-expect-error the handler has no `uidd`
      @Cooldown({ seconds: 3600, by: (_context, { uidd }: { uidd: string }) => uidd })
      async checkIn(_interaction: ButtonInteraction, _params: { ownerId: string; uid: string }) {
        void _params
      }

      @Command('shard', CommandType.SLASH)
      // @ts-expect-error `shard` is a number in the handler
      @Cooldown({ seconds: 60, by: (_context, { shard }: { shard: string }) => shard })
      async shard(_interaction: ChatInputCommandInteraction, _params: { shard: number }) {
        void _params
      }
    }
    void Controller
  })

  it('returns only a key, a number or undefined', () => {
    // @ts-expect-error a boolean is not a key
    Cooldown({ seconds: 5, by: () => true })
  })

  it('falls back to unknown values where the params are not declared', () => {
    Cooldown({
      seconds: 5,
      by: (_context, params) => {
        expectTypeOf(params).toEqualTypeOf<Record<string, unknown>>()
        return typeof params.uid === 'string' ? params.uid : undefined
      },
    })
  })

  it('is typed on CooldownOptions by its params', () => {
    expectTypeOf<CooldownOptions<{ uid: string }>['by']>().parameter(1).toEqualTypeOf<{ uid: string }>()
  })

  it('still composes with applyDecorators, with or without by', () => {
    applyDecorators(Cooldown({ seconds: 5 }), UseGuard(Allow))
    applyDecorators(Cooldown({ seconds: 5, by: (_context, params) => String(params.uid) }), UseGuard(Allow))
  })

  it('applies to a controller, where by reads unknown values', () => {
    @Cooldown({ seconds: 5, by: (_context, params) => (typeof params.uid === 'string' ? params.uid : undefined) })
    class Controller {}
    void Controller
  })
})

describe('@MeoCord({ cooldownStoreFailure })', () => {
  it('takes the exported CooldownStoreFailure', () => {
    const failure: CooldownStoreFailure = 'allow'
    expectTypeOf<CooldownStoreFailure>().toEqualTypeOf<'deny' | 'allow'>()
    expectTypeOf<Parameters<typeof MeoCord>[0]['cooldownStoreFailure']>().toEqualTypeOf<CooldownStoreFailure | undefined>()
    // @ts-expect-error only 'deny' or 'allow'
    const retry: CooldownStoreFailure = 'retry'
    void [failure, retry]
  })
})
