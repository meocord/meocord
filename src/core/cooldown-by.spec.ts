import { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js'
import { vi } from 'vitest'
import { Catch, Command, Controller, Cooldown, Pipe, UseFilter, UsePipe, Validate } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type ExceptionFilter, type PipeInterface, type StandardSchemaV1 } from '@src/interface/index.js'
import { CooldownError, CooldownStore } from '@src/common/index.js'
import { createChatInputOptions, createMockInteraction, inspectHandler, MeoCordTestingModule } from '@src/testing/index.js'

const ran: string[] = []

class AccountLookupError extends Error {}

@Catch(AccountLookupError)
class AccountLookupFilter implements ExceptionFilter<AccountLookupError> {
  catch(): void {
    ran.push('filtered')
  }
}

const account: StandardSchemaV1<unknown, { uid: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    // Trims, so a test can tell the validated output from the raw input
    validate: value => ({ value: { uid: String((value as { uid: string }).uid).trim() } }),
  },
}

class Account {
  constructor(readonly id: string) {}
}

@Pipe()
class AccountPipe implements PipeInterface<string, Account> {
  transform(uid: string): Account {
    return new Account(`account-${uid}`)
  }
}

@Controller()
class CheckInController {
  // The issue's case: once an hour per user, per game account
  @Command('check-in/{ownerId}/{uid}', CommandType.BUTTON)
  @Cooldown({ seconds: 3600, by: (_context, { uid }: { ownerId: string; uid: string }) => uid })
  async checkIn(_interaction: ButtonInteraction, { uid }: { ownerId: string; uid: string }) {
    ran.push(`check-in ${uid}`)
  }

  // Once an hour per account, whoever presses it
  @Command('claim/{uid}', CommandType.BUTTON)
  @Cooldown({ seconds: 3600, per: 'global', by: (_context, { uid }: { uid: string }) => uid })
  async claim(_interaction: ButtonInteraction, { uid }: { uid: string }) {
    ran.push(`claim ${uid}`)
  }

  @Command('shard', CommandType.SLASH)
  @Cooldown({ seconds: 60, by: (_context, { shard }: { shard: number }) => shard })
  async shard(_interaction: ChatInputCommandInteraction, _params: { shard: number }) {
    ran.push('shard')
  }

  @Command('maybe/{uid}', CommandType.BUTTON)
  @Cooldown({ seconds: 60, by: () => undefined })
  async maybe(_interaction: ButtonInteraction, _params: { uid: string }) {
    ran.push('maybe')
  }

  @Command('broken/{uid}', CommandType.BUTTON)
  @UseFilter(AccountLookupFilter)
  @Cooldown({ seconds: 5 })
  @Cooldown({
    seconds: 60,
    by: () => {
      throw new AccountLookupError('no such account')
    },
  })
  async broken(_interaction: ButtonInteraction, _params: { uid: string }) {
    ran.push('broken')
  }

  @Command('rejecting/{uid}', CommandType.BUTTON)
  @Cooldown({ seconds: 60, by: async () => Promise.reject(new AccountLookupError('lookup timed out')) })
  async rejecting(_interaction: ButtonInteraction, _params: { uid: string }) {
    ran.push('rejecting')
  }

  @Command('validated/{uid}', CommandType.BUTTON)
  @Validate(account)
  @Cooldown({ seconds: 60, by: (_context, { uid }: { uid: string }) => uid })
  async validated(_interaction: ButtonInteraction, _params: { uid: string }) {
    ran.push('validated')
  }

  @Command('piped/{uid}', CommandType.BUTTON)
  @UsePipe('uid', AccountPipe)
  @Cooldown({ seconds: 60, by: async (context, { uid }: { uid: Account }) => `${context.getInteraction()?.user.id}/${uid.id}` })
  async piped(_interaction: ButtonInteraction, _params: { uid: Account }) {
    ran.push('piped')
  }
}

const press = (customId: string, user = 'ada') =>
  createMockInteraction(ButtonInteraction, { customId, user: { id: user } as never, guildId: 'guild-1', channelId: 'channel-1' })

/** A module whose store records every key it is asked to count, and allows every call. */
function recording() {
  const keys: string[] = []
  const consume = vi.fn(async (key: string) => {
    keys.push(key)
    return { allowed: true, retryAfterMs: 0 }
  })
  const module = MeoCordTestingModule.create({
    controllers: [CheckInController],
    providers: [{ provide: CooldownStore, useValue: { consume } }],
  }).compile()
  return { module, keys, consume }
}

let module: ReturnType<typeof compile>
const compile = () => MeoCordTestingModule.create({ controllers: [CheckInController] }).compile()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  ran.length = 0
  module = compile()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('@Cooldown({ by })', () => {
  it('counts each account separately for the same user', async () => {
    await module.invoke(CheckInController, 'checkIn', press('check-in/ada/800000001'))
    await module.invoke(CheckInController, 'checkIn', press('check-in/ada/800000002'))
    await module.invoke(CheckInController, 'checkIn', press('check-in/ada/800000003'))

    await expect(module.invoke(CheckInController, 'checkIn', press('check-in/ada/800000001'))).rejects.toBeInstanceOf(
      CooldownError,
    )
    expect(ran).toEqual(['check-in 800000001', 'check-in 800000002', 'check-in 800000003'])
  })

  it('still counts per user: another user checks the same account in', async () => {
    await module.invoke(CheckInController, 'checkIn', press('check-in/ada/800000001', 'ada'))
    await module.invoke(CheckInController, 'checkIn', press('check-in/grace/800000001', 'grace'))

    expect(ran).toEqual(['check-in 800000001', 'check-in 800000001'])
  })

  it("with per: 'global', counts each resource across every user", async () => {
    await module.invoke(CheckInController, 'claim', press('claim/800000001', 'ada'))
    await module.invoke(CheckInController, 'claim', press('claim/800000002', 'grace'))

    await expect(module.invoke(CheckInController, 'claim', press('claim/800000001', 'grace'))).rejects.toMatchObject({
      per: 'global',
    })
    expect(ran).toEqual(['claim 800000001', 'claim 800000002'])
  })

  it('adds the value to the key after the scope, a number as its digits', async () => {
    const { module, keys } = recording()

    await module.invoke(CheckInController, 'checkIn', press('check-in/ada/800000001'))
    await module.invoke(CheckInController, 'claim', press('claim/800000001'))
    await module.invoke(
      CheckInController,
      'shard',
      createMockInteraction(ChatInputCommandInteraction, {
        user: { id: 'ada' } as never,
        options: createChatInputOptions({ shard: 3 }),
      }),
    )

    expect(keys).toEqual([
      'CheckInController.checkIn#3600000:user:user:ada:by:800000001',
      'CheckInController.claim#3600000:global:global:by:800000001',
      'CheckInController.shard#60000:user:user:ada:by:3',
    ])
  })

  it('encodes the value, so one holding a colon cannot pass for another key', async () => {
    const { module, keys } = recording()

    // Unencoded, both would count under `…:by:a:by:b`
    await module.invoke(CheckInController, 'checkIn', press('check-in/ada/a:by:b'))
    await module.invoke(CheckInController, 'checkIn', press('check-in/ada/a%3Aby%3Ab'))

    expect(keys).toEqual([
      'CheckInController.checkIn#3600000:user:user:ada:by:a%3Aby%3Ab',
      'CheckInController.checkIn#3600000:user:user:ada:by:a%253Aby%253Ab',
    ])
    expect(new Set(keys).size).toBe(2)
  })

  it('counts without a value when it returns undefined, under the by part alone', async () => {
    const { module, keys } = recording()

    await module.invoke(CheckInController, 'maybe', press('maybe/800000001'))

    expect(keys).toEqual(['CheckInController.maybe#60000:user:user:ada:by'])
  })

  it('sends an error thrown by by through the exception filters, and counts none of the cooldowns', async () => {
    const { module, consume } = recording()

    await expect(module.invoke(CheckInController, 'broken', press('broken/800000001'))).resolves.toMatchObject({
      ran: false,
      error: expect.any(AccountLookupError),
    })
    expect(ran).toEqual(['filtered'])
    expect(consume).not.toHaveBeenCalled()
  })

  it('rejects with an error by rejects with, when no filter catches it, and counts nothing', async () => {
    const { module, consume } = recording()

    await expect(module.invoke(CheckInController, 'rejecting', press('rejecting/800000001'))).rejects.toThrow(
      'lookup timed out',
    )
    expect(ran).toEqual([])
    expect(consume).not.toHaveBeenCalled()
  })

  it('reads the params the handler receives: validated, then piped', async () => {
    const { module, keys } = recording()

    await module.invoke(CheckInController, 'validated', press('validated/ 800000001 '))
    await module.invoke(CheckInController, 'piped', press('piped/800000001'))

    expect(keys).toEqual([
      'CheckInController.validated#60000:user:user:ada:by:800000001',
      'CheckInController.piped#60000:user:user:ada:by:ada%2Faccount-800000001',
    ])
  })

  it('is reported by inspectHandler', () => {
    expect(inspectHandler(CheckInController, 'broken').cooldowns).toEqual([
      { seconds: 5, uses: 1, per: 'user', bypass: false, by: false },
      { seconds: 60, uses: 1, per: 'user', bypass: false, by: true },
    ])
  })
})
