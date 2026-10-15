import 'reflect-metadata'
import * as discord from 'discord.js'
import {
  ButtonComponent,
  ButtonInteraction,
  ChannelType,
  ComponentType,
  DiscordjsErrorCodes,
  ModalSubmitInteraction,
  PartialGroupDMChannel,
  Role,
  StageChannel,
  StringSelectMenuInteraction,
  TextChannel,
  ThreadChannel,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'
import { createMockChannel, createMockClient, createMockGuild, createMockInteraction, createMockMember, createMockMessage } from './index.js'

afterEach(() => {
  forgetStrictMocks()
  vi.useRealTimers()
})

const MODES = [
  ['in default mode', () => undefined],
  ['under useStrictMocks()', () => useStrictMocks()],
] as const
const DAY_MS = 86_400_000
const GUILD_ID = '100000000000000001'

interface ChannelClass { prototype: object; name: string }
const isChannelClass = (value: unknown): value is ChannelClass => {
  const prototype: unknown = typeof value === 'function' ? (value as { prototype?: unknown }).prototype : undefined
  return typeof prototype === 'object' && prototype !== null && discord.BaseChannel.prototype.isPrototypeOf(prototype)
}

// The channel classes discord.js makes, those no other channel class extends
const channelClasses = (): ChannelClass[] => {
  const all = (Object.values(discord) as unknown[]).filter(isChannelClass)
  return all.filter(Class => !all.some(Other => Other !== Class && Class.prototype.isPrototypeOf(Other.prototype)))
}

describe.each(MODES)('a mock component interaction and modal, %s', (_, mode) => {
  beforeEach(() => mode())

  it('has the bot message it was used on, which edits and deletes', async () => {
    const click = createMockInteraction(ButtonInteraction, { customId: 'b' })

    await expect(click.message.edit('x')).resolves.toBe(click.message)
    expect(click.message.content).toBe('x')
    await expect(click.message.delete()).resolves.toBeUndefined()
    expect(click.message.author.id).toBe(click.client.user.id)
  })

  it('finds the component it was used on in that message, as discord.js does', () => {
    const click = createMockInteraction(ButtonInteraction, { customId: 'buy' })

    expect(click.component).toBeInstanceOf(ButtonComponent)
    expect([click.component.customId, click.component.type]).toEqual(['buy', ComponentType.Button])
  })

  it('reads a modal with no fields given as one with none', () => {
    const submit = createMockInteraction(ModalSubmitInteraction, { customId: 'f' })

    expect(submit.components).toEqual([])
    expect(() => submit.fields.getTextInputValue('reason')).toThrow(expect.objectContaining({ code: DiscordjsErrorCodes.ModalSubmitInteractionFieldNotFound }))
  })

  it.each([
    ['ButtonInteraction', () => createMockInteraction(ButtonInteraction)],
    ['StringSelectMenuInteraction', () => createMockInteraction(StringSelectMenuInteraction)],
  ] as const)('has a message for a %s made with no customId', (_, make) => {
    const click = make()

    expect(click.message.components).toHaveLength(1)
  })

  it("reads a thread's server id from the guild it was given", () => {
    const guild = createMockGuild()
    expect(createMockChannel(ThreadChannel, { guild }).guildId).toBe(guild.id)
  })

  it('gives every channel class discord.js makes its type, so its guards answer as discord.js does', () => {
    const classes = channelClasses()
    expect(classes.length).toBeGreaterThan(8)
    const types = Object.values(ChannelType).filter(value => typeof value === 'number')
    const missing = classes.filter(Class => !types.includes(createMockChannel(Class as never).type as never)).map(Class => Class.name)

    expect(missing).toEqual([])
    expect([createMockChannel(PartialGroupDMChannel).isDMBased(), createMockChannel(StageChannel).isVoiceBased()]).toEqual([true, true])
  })

  it("computes a member's display colour and its roles' colour, hoist and icon from its roles", () => {
    const guild = createMockGuild()
    const plain = createMockMember({ guild })
    expect([plain.displayColor, plain.displayHexColor, plain.roles.color, plain.roles.hoist, plain.roles.icon]).toEqual([0, '#000000', null, null, null])

    const red = createMockInteraction(Role, { guild, position: 2, hoist: true, colors: { primaryColor: 0xff0000, secondaryColor: null, tertiaryColor: null } })
    const member = createMockMember({ guild, roles: [red] })
    expect([member.displayColor, member.displayHexColor, member.roles.color, member.roles.hoist]).toEqual([0xff0000, '#ff0000', red, red])
  })
})

const W_STAMPED = /^(GuildMember\.joinedTimestamp|Client\.readyTimestamp) here is the time it was first read; under useStrictMocks\(\) it is the time the mock was made/

describe("a member's join and a client's ready time", () => {
  let warned: string[]
  beforeEach(() => {
    forgetDeprecationWarnings()
    warned = []
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
  })
  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['in default mode', () => undefined, 0, [W_STAMPED, W_STAMPED]],
    ['under useStrictMocks()', () => useStrictMocks(), 10 * DAY_MS, []],
  ] as const)('are stamped when the mock is made under strict mocks, at the first read in default mode, %s', (_, mode, elapsed, warnings) => {
    mode()
    vi.useFakeTimers()
    const member = createMockMember({ guild: createMockGuild() })
    const client = createMockClient()
    vi.advanceTimersByTime(10 * DAY_MS)

    expect([Date.now() - member.joinedTimestamp!, client.uptime]).toEqual([elapsed, elapsed])
    expect(warned).toEqual(warnings.map(text => expect.stringMatching(text)))
  })

  it('warn once in default mode for a read straight after the mock is made, under real timers', () => {
    const member = createMockMember({ guild: createMockGuild() })
    const before = Date.now()

    expect(member.joinedTimestamp).toBeGreaterThanOrEqual(before)
    expect(createMockMember({ guild: createMockGuild() }).joinedTimestamp).toBeGreaterThanOrEqual(before)
    expect(warned).toEqual([expect.stringMatching(W_STAMPED)])
  })
})

describe('a mock channel or thread given only a guildId, under useStrictMocks()', () => {
  it.each([
    ['a channel', () => createMockChannel(TextChannel, { guildId: GUILD_ID })],
    ['a thread', () => createMockChannel(ThreadChannel, { guildId: GUILD_ID } as never)],
  ])('is in a server with that id: %s', (_, made) => {
    useStrictMocks()
    const channel = made()
    expect([channel.guild.id, channel.guildId]).toEqual([GUILD_ID, GUILD_ID])
  })
})

describe('a component interaction given its message', () => {
  it('reads that message, and the component it holds', () => {
    const message = createMockMessage({ components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, custom_id: 'go', style: 1 }] }] as never })
    const click = createMockInteraction(ButtonInteraction, { customId: 'go', message })

    expect(click.message).toBe(message)
    expect(click.component).toBeInstanceOf(ButtonComponent)
  })
})
