// A project that turns on typed mock values. Checked by `bun run lint` against src, and by `check:dist-types` against
// the built declarations, as ESM and as CommonJS, with the module renamed to `meocord/testing`.
import { ButtonInteraction, type Collection, type GuildMember, type GuildMemberManager, type InteractionResponse } from 'discord.js'
import { createMockFn, createMockInteraction, type MockedFunction } from '@src/testing/index.js'

declare module '@src/testing/index.js' {
  interface MockTypeOptions {
    typedValues: true
  }
}

declare function number(value: number): void
declare function text(value: string): void

const double = createMockFn((value: number) => value * 2)
double.mockReturnValue(4)
// @ts-expect-error not what the function returns
double.mockReturnValue('4')
double.mockImplementation(value => value + 1)
// @ts-expect-error nor a function of another argument
double.mockImplementation((value: string) => value.length)
number(double.mock.calls[0][0])
// @ts-expect-error a recorded argument is the function's own, not any
text(double.mock.calls[0][0])
number(double.mock.results[0].value)
// @ts-expect-error a recorded result too
text(double.mock.results[0].value)

const load = createMockFn(async (id: string) => ({ id, name: `user ${id}` }))
load.mockResolvedValue({ id: '1', name: 'one' })
// What a mock's answers resolve to by default
load.mockResolvedValue(undefined)
load.mockResolvedValueOnce(undefined)
// @ts-expect-error a partial fake
load.mockResolvedValue({ id: '1' })
number(load.mock.settledResults[0].value?.name.length ?? 0)
// @ts-expect-error a settled value is what the function resolves to
text(load.mock.settledResults[0].value?.name.length ?? 0)

// An overloaded function: a union over its signatures
declare const fetch: MockedFunction<GuildMemberManager['fetch']>
declare const member: GuildMember
declare const members: Collection<string, GuildMember>
fetch.mockResolvedValue(member)
fetch.mockResolvedValue(members)
// @ts-expect-error a partial fake of a member
fetch.mockResolvedValue({ id: '1' })

// The mock factories' methods, typed from discord.js's
const interaction = createMockInteraction(ButtonInteraction, { customId: 'save' })
declare const response: InteractionResponse
interaction.reply.mockResolvedValue(response)
interaction.reply.mockResolvedValue(undefined)
// @ts-expect-error not what reply resolves to
interaction.reply.mockResolvedValue('sent')
