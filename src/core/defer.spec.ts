import { Container } from 'inversify'
import {
  type APIEmbed,
  type APIMessageTopLevelComponent,
  ApplicationIntegrationType,
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
  ComponentType,
  EmbedType,
  InteractionContextType,
  type Message,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  type MessageReaction,
  resolveColor,
} from 'discord.js'
import { vi } from 'vitest'
import { Autocomplete, Command, Controller, Cooldown, Defer, Guard, MessageHandler, On, ReactionHandler, UseGuard } from '@src/decorator/index.js'
import { CommandType, MetadataKey } from '@src/enum/index.js'
import { type GuardInterface } from '@src/interface/index.js'
import { GuardDeniedError } from '@src/common/errors.js'
import { LOCK_MEMORY_MS, lockedMessageCount, respond } from '@src/common/response/response-state.js'
import { defaultPresenter, renderContainer, renderEmbed, RENDERED_CONTAINER_ID } from '@src/common/response/presenter.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { MeoCordApp } from '@src/core/meocord.app.js'
import { createChatInputOptions, createDiscordError, createMockInteraction, createMockMessage, getResponse } from '@src/testing/index.js'

const { Ephemeral, IsComponentsV2, SuppressNotifications } = MessageFlags
type Json = Record<string, unknown>
interface Payload { flags?: number; embeds?: APIEmbed[]; components?: Json[]; content?: string }

const row = (): Json => ({
  type: ComponentType.ActionRow,
  components: [
    { type: ComponentType.Button, style: 1, custom_id: 'card/refresh', label: 'Refresh', emoji: { name: '🔄' } },
    { type: ComponentType.Button, style: 2, custom_id: 'card/other', label: 'Other', disabled: true },
    { type: ComponentType.Button, style: 2, custom_id: 'card/next', label: 'Next' },
  ],
})

function messageWith(options: { flags?: number; embeds?: APIEmbed[]; components?: Json[] } = {}): Message {
  return createMockMessage({
    flags: options.flags,
    embeds: options.embeds ?? [{ description: 'card' }],
    components: (options.components ?? [row()]) as unknown as APIMessageTopLevelComponent[],
  })
}

const loadingView = defaultPresenter.loading({ theme: DEFAULT_THEME } as never)
const calls = (interaction: object) => getResponse(interaction as never).calls.map(call => call.method)
const payloads = (interaction: object) => getResponse(interaction as never).calls.map(call => call.payload as Payload)
const buttonsOf = (payload: Payload) => (payload.components?.[0].components as Json[]) ?? []

let guardAllows: boolean | 'throw' | 'followUp' = true

@Guard()
class OwnerGuard implements GuardInterface {
  async canActivate(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<boolean> {
    log.push(`guard:deferred=${interaction.deferred}`)
    if (guardAllows === 'throw') throw new GuardDeniedError('Only the owner can use this.')
    if (guardAllows === 'followUp') {
      await respond(interaction).followUp({ content: 'Not yours.', flags: Ephemeral })
      return false
    }
    return guardAllows
  }
}

const log: string[] = []
let handlerBody: (interaction: ButtonInteraction | ChatInputCommandInteraction) => Promise<void> = async () => {}

@Controller()
class CardController {
  @Command('card', CommandType.SLASH)
  @UseGuard(OwnerGuard)
  @Defer()
  async card(interaction: ChatInputCommandInteraction) {
    await handlerBody(interaction)
  }

  @Command('secret', CommandType.SLASH)
  @Defer({ ephemeral: true })
  async secret(interaction: ChatInputCommandInteraction) {
    await handlerBody(interaction)
  }

  @Command('card/{action}', CommandType.BUTTON)
  @UseGuard(OwnerGuard)
  @Defer()
  async button(interaction: ButtonInteraction) {
    await handlerBody(interaction)
  }

  @Command('clicked/{action}', CommandType.BUTTON)
  @Defer({ disable: 'clicked' })
  async clickedOnly(interaction: ButtonInteraction) {
    await handlerBody(interaction)
  }

  @Command('fast/{action}', CommandType.BUTTON)
  @Defer({ mode: 'auto', suppressNotifications: true })
  async fast(interaction: ButtonInteraction) {
    await handlerBody(interaction)
  }

  @Command('guarded-fast/{action}', CommandType.BUTTON)
  @UseGuard(OwnerGuard)
  @Defer({ mode: 'auto' })
  async guardedFast(interaction: ButtonInteraction) {
    await handlerBody(interaction)
  }

  @Command('secret-slow', CommandType.SLASH)
  @Defer({ mode: 'auto', ephemeral: true })
  async secretSlow(interaction: ChatInputCommandInteraction) {
    await handlerBody(interaction)
  }

  @Command('slow-command', CommandType.SLASH)
  @UseGuard(OwnerGuard)
  @Defer({ mode: 'auto' })
  async slowCommand(interaction: ChatInputCommandInteraction) {
    await handlerBody(interaction)
  }

  @Command('quiet/{action}', CommandType.BUTTON)
  @Defer({ disable: 'none' })
  async quiet(interaction: ButtonInteraction) {
    await handlerBody(interaction)
  }

  @Command('ask/{action}', CommandType.BUTTON)
  @Defer({ mode: 'auto' })
  async ask(interaction: ButtonInteraction) {
    await handlerBody(interaction)
  }

  @Command('limited/{action}', CommandType.BUTTON)
  @Cooldown({ seconds: 60 })
  @Defer()
  async limited(interaction: ButtonInteraction) {
    await handlerBody(interaction)
  }

  @Command('pick/{action}', CommandType.SELECT_MENU)
  @Defer()
  async pick(interaction: StringSelectMenuInteraction) {
    await handlerBody(interaction as never)
  }

  @Command('who/{action}', CommandType.USER_SELECT_MENU)
  @Defer()
  async who(interaction: UserSelectMenuInteraction) {
    await handlerBody(interaction as never)
  }

  @Command('form', CommandType.MODAL_SUBMIT)
  @Defer()
  async form(interaction: ModalSubmitInteraction) {
    await handlerBody(interaction as never)
  }
}

async function startApp() {
  const container = new Container()
  container.bind(CardController).toSelf().inSingletonScope()
  Reflect.defineMetadata(MetadataKey.Container, container, CardController)
  const listeners = new Map<string, (...args: unknown[]) => Promise<void>>()
  const client = {
    on: vi.fn((event: string, listener: (...args: unknown[]) => Promise<void>) => listeners.set(event, listener)),
    login: vi.fn().mockResolvedValue('token'),
    user: { setActivity: vi.fn() },
    application: null,
  }
  await new MeoCordApp([CardController], container, client as never, 't').start()
  return (interaction: unknown) => listeners.get('interactionCreate')!(interaction)
}

const contexts = [
  ['a server the bot was added to', InteractionContextType.Guild, { [ApplicationIntegrationType.GuildInstall]: 'g' }],
  ['a server the bot is not in', InteractionContextType.Guild, { [ApplicationIntegrationType.UserInstall]: 'u' }],
  ['a direct message with the bot', InteractionContextType.BotDM, { [ApplicationIntegrationType.UserInstall]: 'u' }],
  ['a private channel between users', InteractionContextType.PrivateChannel, { [ApplicationIntegrationType.UserInstall]: 'u' }],
] as const

beforeEach(() => {
  log.length = 0
  guardAllows = true
  handlerBody = async () => {}
})

describe.each(contexts)('@Defer in %s', (_where, context, owners) => {
  const where = { context, authorizingIntegrationOwners: owners }
  const slash = (commandName = 'card') => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName, ...where })
    interaction.options = createChatInputOptions({})
    return interaction
  }
  const click = (options: { flags?: number; customId?: string } = {}) =>
    createMockInteraction(ButtonInteraction, {
      customId: options.customId ?? 'card/refresh',
      message: messageWith({ flags: options.flags }),
      ...where,
    })

  it('defers a command before its guards, and send() edits the deferred reply', async () => {
    const emit = await startApp()
    handlerBody = async interaction => void (await respond(interaction).send('done'))
    const interaction = slash()

    await emit(interaction)

    expect(log).toEqual(['guard:deferred=true'])
    expect(calls(interaction)).toEqual(['deferReply', 'editReply'])
  })

  it('locks a public card after its guards, then send() restores its components without the loading view', async () => {
    const emit = await startApp()
    handlerBody = async interaction => void (await respond(interaction).send({ embeds: [{ description: 'new card' }] }))
    const interaction = click()

    await emit(interaction)

    expect(calls(interaction)).toEqual(['deferUpdate', 'editReply', 'editReply'])
    const [, lock, answer] = payloads(interaction)
    expect(buttonsOf(lock).map(button => button.disabled)).toEqual([true, true, true])
    expect(buttonsOf(lock)[0].emoji).toEqual({ name: '⏳' })
    expect(lock.embeds).toEqual([{ description: 'card' }, renderEmbed(loadingView)])
    expect(answer.components).toEqual([row()])
    // respond() fills the embed's colour from the theme
    expect(answer.embeds).toEqual([{ description: 'new card', color: resolveColor(DEFAULT_THEME.colors.primary) }])
  })

  it('locks a private card too, through the interaction', async () => {
    const emit = await startApp()
    const interaction = click({ flags: Ephemeral })

    await emit(interaction)

    expect(calls(interaction)).toEqual(['deferUpdate', 'editReply', 'editReply'])
    expect(payloads(interaction)[2]).toMatchObject({ components: [row()], embeds: [{ description: 'card' }] })
  })

  it('restores the card and follows up privately when the handler throws before answering', async () => {
    const emit = await startApp()
    handlerBody = async () => {
      throw new Error('failed')
    }
    const interaction = click()

    await emit(interaction)

    expect(calls(interaction)).toEqual(['deferUpdate', 'editReply', 'editReply', 'followUp'])
    expect(payloads(interaction)[2].components).toEqual([row()])
    expect(payloads(interaction)[3].flags).toBe(Ephemeral)
  })

  it('adds the error to a private card, restored', async () => {
    const emit = await startApp()
    handlerBody = async () => {
      throw new Error('failed')
    }
    const interaction = click({ flags: Ephemeral })

    await emit(interaction)

    const last = payloads(interaction).at(-1)!
    expect(last.components).toEqual([row()])
    expect(last.embeds?.map(embed => embed.description)).toEqual(['card', 'An error occurred while executing the command.'])
    expect(calls(interaction)).not.toContain('followUp')
  })

  it("edits a command's deferred reply into the error when it threw", async () => {
    const emit = await startApp()
    handlerBody = async () => {
      throw new Error('failed')
    }
    const interaction = slash()

    await emit(interaction)

    expect(calls(interaction)).toEqual(['deferReply', 'editReply'])
    expect(payloads(interaction)[1].embeds?.[0].description).toBe('An error occurred while executing the command.')
  })

  it('leaves no reply when a guard denies a command silently', async () => {
    const emit = await startApp()
    guardAllows = false
    const interaction = slash()

    await emit(interaction)

    expect(calls(interaction)).toEqual(['deferReply', 'deleteReply'])
  })

  it("sends no edit when a stranger's click is denied on a public card", async () => {
    const emit = await startApp()
    guardAllows = false
    const interaction = click()

    await emit(interaction)

    expect(calls(interaction)).toEqual(['deferUpdate'])
  })

  it('answers a guard that throws privately, without touching the card', async () => {
    const emit = await startApp()
    guardAllows = 'throw'
    const interaction = click()

    await emit(interaction)

    expect(calls(interaction)).toEqual(['deferUpdate', 'followUp'])
    expect(payloads(interaction)[1].flags).toBe(Ephemeral)
  })

  it('keeps a private error off a public deferred command: delete, then follow up', async () => {
    const emit = await startApp()
    guardAllows = 'throw'
    const interaction = slash()

    await emit(interaction)

    expect(calls(interaction)).toEqual(['deferReply', 'deleteReply', 'followUp'])
    expect(payloads(interaction)[2].embeds?.[0].description).toBe('Only the owner can use this.')
  })

  it('keeps the message of a guard that followed up before returning false', async () => {
    const emit = await startApp()
    guardAllows = 'followUp'
    const interaction = slash()

    await emit(interaction)

    // The guard's private notice replaces the public deferral rather than becoming it
    expect(calls(interaction)).toEqual(['deferReply', 'deleteReply', 'followUp'])
  })

  it('makes a command’s deferred reply private with ephemeral', async () => {
    const emit = await startApp()
    const interaction = slash('secret')

    await emit(interaction)

    expect(payloads(interaction)[0].flags).toBe(Ephemeral)
  })

  it('treats a modal submitted from a command like a command, and one from a message like a component', async () => {
    const emit = await startApp()
    const fromCommand = createMockInteraction(ModalSubmitInteraction, { customId: 'form', ...where })
    const fromMessage = createMockInteraction(ModalSubmitInteraction, { customId: 'form', message: messageWith(), ...where })

    await emit(fromCommand)
    await emit(fromMessage)

    expect(calls(fromCommand)[0]).toBe('deferReply')
    expect(calls(fromMessage)).toEqual(['deferUpdate', 'editReply', 'editReply'])
  })
})

describe('@Defer', () => {
  const click = (customId: string, message = messageWith()) => createMockInteraction(ButtonInteraction, { customId, message })

  it('puts the card back when the handler returns without answering', async () => {
    const emit = await startApp()
    const interaction = click('card/refresh')

    await emit(interaction)

    expect(payloads(interaction)[2]).toEqual(expect.objectContaining({ components: [row()], embeds: [{ description: 'card' }] }))
  })

  it('does not restore over an edit something else made after the lock', async () => {
    const emit = await startApp()
    const interaction = click('card/refresh')
    // Edited after the lock, as Discord stamps an edit something else makes
    interaction.fetchReply.mockResolvedValue(
      createMockMessage({ components: [{ type: ComponentType.ActionRow, components: [] }], editedTimestamp: Date.now() + 60_000 }) as never,
    )

    await emit(interaction)

    expect(calls(interaction)).toEqual(['deferUpdate', 'editReply'])
  })

  it('never re-enables a button that was disabled before, nor moves the loading emoji', async () => {
    const emit = await startApp()
    handlerBody = async interaction => void (await respond(interaction).send({ content: 'x' }))
    const interaction = click('card/next')

    await emit(interaction)

    const [, lock, answer] = payloads(interaction)
    expect(buttonsOf(lock)[2].emoji).toEqual({ name: '⏳' })
    expect(buttonsOf(lock)[0].emoji).toEqual({ name: '🔄' })
    expect(buttonsOf(answer)).toEqual(row().components)
  })

  it("disables only the clicked control with disable: 'clicked'", async () => {
    const emit = await startApp()
    const interaction = click('clicked/next', messageWith({ components: [{ ...row(), components: [{ type: 2, style: 1, custom_id: 'clicked/next' }, { type: 2, style: 1, custom_id: 'clicked/keep' }] }] }))

    await emit(interaction)

    expect(buttonsOf(payloads(interaction)[1]).map(button => button.disabled)).toEqual([true, undefined])
  })

  describe("two clicks on one message with disable: 'clicked'", () => {
    const button = (id: string) => ({ type: ComponentType.Button, style: 1, custom_id: `clicked/${id}`, label: id })
    const original: Json[] = [{ type: ComponentType.ActionRow, components: [button('a'), button('b')] }]

    /** One Discord message both clicks edit: each edit replaces it, and fetchReply() reads it back. */
    let messages = 0
    function sharedMessage() {
      let current: Json[] = original
      const id = `card-${++messages}`
      const read = () => Object.assign(messageWith({ components: current, embeds: [] }), { id })
      const clickOn = (id: string) => {
        const interaction = click(`clicked/${id}`, read())
        interaction.editReply.mockImplementation(async payload => {
          current = ((payload as Payload).components ?? current) as Json[]
          return read() as never
        })
        interaction.fetchReply.mockImplementation(async () => read() as never)
        return interaction
      }
      return { clickOn, current: () => current }
    }

    function holdHandlers() {
      const gates = new Map<string, () => void>()
      handlerBody = interaction => new Promise<void>(resolve => gates.set((interaction as ButtonInteraction).customId, resolve))
      return (customId: string) => gates.get(customId)!()
    }

    const buttons = (components: Json[]) => (components[0].components as Json[]).map(({ disabled, emoji }) => ({ disabled, emoji }))
    const spinner = { name: '⏳' }

    it("puts back each click's own control, whichever finishes first", async () => {
      const emit = await startApp()
      const finish = holdHandlers()
      const message = sharedMessage()

      const first = message.clickOn('a')
      const firstDone = emit(first)
      await vi.waitFor(() => expect(calls(first)).toContain('editReply'))
      // The second click is on the message as the first one's lock left it
      const second = message.clickOn('b')
      const secondDone = emit(second)
      await vi.waitFor(() => expect(calls(second)).toContain('editReply'))
      expect(buttons(message.current())).toEqual([{ disabled: true, emoji: spinner }, { disabled: true, emoji: spinner }])

      finish('clicked/a')
      await firstDone
      expect(buttons(message.current())).toEqual([{ disabled: undefined, emoji: undefined }, { disabled: true, emoji: spinner }])

      finish('clicked/b')
      await secondDone
      expect(message.current()).toEqual(original)
    })

    it("never writes back the first click's spinner once it finished before the second locked", async () => {
      const emit = await startApp()
      const finish = holdHandlers()
      const message = sharedMessage()

      const first = message.clickOn('a')
      const firstDone = emit(first)
      await vi.waitFor(() => expect(calls(first)).toContain('editReply'))
      const second = message.clickOn('b')
      finish('clicked/a')
      await firstDone

      const secondDone = emit(second)
      await vi.waitFor(() => expect(calls(second)).toContain('editReply'))
      finish('clicked/b')
      await secondDone

      expect(message.current()).toEqual(original)
    })

    it('forgets the message once every click settled, on success and on error', async () => {
      vi.useFakeTimers({ now: Date.now(), toFake: ['setTimeout', 'clearTimeout'] })
      const emit = await startApp()
      const message = sharedMessage()
      const before = lockedMessageCount()
      handlerBody = async () => {}
      await emit(message.clickOn('a'))
      handlerBody = async () => {
        throw new Error('failed')
      }
      await emit(message.clickOn('b'))

      expect(lockedMessageCount()).toBe(before + 1)
      await vi.advanceTimersByTimeAsync(LOCK_MEMORY_MS)
      expect(lockedMessageCount()).toBe(before)
      vi.useRealTimers()
    })
  })

  it('drops a loading view left behind by a crash before snapshotting', async () => {
    const emit = await startApp()
    const leftover = messageWith({ embeds: [{ description: 'card' }, renderEmbed(loadingView)] })
    const interaction = click('card/refresh', leftover)

    await emit(interaction)

    expect(payloads(interaction)[1].embeds).toEqual([{ description: 'card' }, renderEmbed(loadingView)])
    expect(getResponse(interaction).calls.length).toBe(3)
    expect(payloads(interaction)[2].embeds).toEqual([{ description: 'card' }])
  })

  // Discord returns every embed a bot sent with its type, which the rendered view does not carry
  it('drops a leftover loading view as Discord returns it, with its type', async () => {
    const emit = await startApp()
    const leftover = messageWith({ embeds: [{ description: 'card' }, { ...renderEmbed(loadingView), type: EmbedType.Rich }] })
    const interaction = click('card/refresh', leftover)

    await emit(interaction)

    expect(payloads(interaction)[1].embeds).toEqual([{ description: 'card' }, renderEmbed(loadingView)])
    expect(payloads(interaction)[2].embeds).toEqual([{ description: 'card' }])
  })

  it('drops a leftover loading container, and adds one, on a Components V2 card', async () => {
    const emit = await startApp()
    const card = { type: ComponentType.Container, components: [row()] }
    const leftover = { ...renderContainer(loadingView) }
    const interaction = click('card/refresh', messageWith({ flags: IsComponentsV2, components: [card, leftover] }))

    await emit(interaction)

    const [, lock, restore] = payloads(interaction)
    expect(lock.components?.at(-1)).toMatchObject({ id: RENDERED_CONTAINER_ID })
    expect(lock.components).toHaveLength(2)
    expect(lock.flags).toBe(IsComponentsV2)
    expect(restore.components).toEqual([card])
  })

  it('leaves the loading view out, still locking, when the card has 10 embeds', async () => {
    const emit = await startApp()
    const embeds = Array.from({ length: 10 }, (_, index) => ({ description: `e${index}` }))
    const interaction = click('card/refresh', messageWith({ embeds }))

    await emit(interaction)

    expect(payloads(interaction)[1].embeds).toEqual(embeds)
    expect(buttonsOf(payloads(interaction)[1])[0].disabled).toBe(true)
  })

  describe("mode: 'auto'", () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('answers a fast handler with a single update, never deferring', async () => {
      vi.useFakeTimers({ now: Date.now() })
      const emit = await startApp()
      handlerBody = async interaction => void (await respond(interaction).send({ content: 'quick' }))
      const interaction = click('fast/go')
      Object.assign(interaction, { createdTimestamp: Date.now() })

      await emit(interaction)
      await vi.advanceTimersByTimeAsync(5_000)

      expect(calls(interaction)).toEqual(['update'])
    })

    it('acknowledges a slow handler no later than 2.5 s after the interaction was created', async () => {
      vi.useFakeTimers({ now: Date.now() })
      const emit = await startApp()
      let finish!: () => void
      handlerBody = () => new Promise<void>(resolve => (finish = resolve))
      const interaction = click('fast/go')
      Object.assign(interaction, { createdTimestamp: Date.now() - 2_000 })

      const done = emit(interaction)
      await vi.advanceTimersByTimeAsync(499)
      expect(calls(interaction)).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(calls(interaction)[0]).toBe('deferUpdate')
      finish()
      await done
    })

    it('acknowledges after 1.5 s when the interaction has no creation time, rather than at once', async () => {
      vi.useFakeTimers({ now: Date.now() })
      const emit = await startApp()
      let finish!: () => void
      handlerBody = () => new Promise<void>(resolve => (finish = resolve))
      const interaction = click('fast/go')
      Object.defineProperty(interaction, 'createdTimestamp', { value: undefined, configurable: true })

      const done = emit(interaction)
      await vi.advanceTimersByTimeAsync(1_499)
      expect(calls(interaction)).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(calls(interaction)[0]).toBe('deferUpdate')
      finish()
      await done
    })

    // Unacknowledged, Discord shows the user that the interaction failed
    it('acknowledges invisibly when a guard denies a click silently before the timer', async () => {
      vi.useFakeTimers({ now: Date.now() })
      const emit = await startApp()
      guardAllows = false
      const interaction = click('guarded-fast/go')
      Object.assign(interaction, { createdTimestamp: Date.now() })

      await emit(interaction)
      await vi.advanceTimersByTimeAsync(5_000)

      expect(calls(interaction)).toEqual(['deferUpdate'])
    })

    it('leaves no reply when a guard denies a command silently before the timer', async () => {
      vi.useFakeTimers({ now: Date.now() })
      const emit = await startApp()
      guardAllows = false
      const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'slow-command', createdTimestamp: Date.now() })
      interaction.options = createChatInputOptions({})

      await emit(interaction)
      await vi.advanceTimersByTimeAsync(5_000)

      expect(calls(interaction)).toEqual(['deferReply', 'deleteReply'])
    })

    it('acknowledges invisibly when a handler returns before the timer without answering', async () => {
      vi.useFakeTimers({ now: Date.now() })
      const emit = await startApp()
      const interaction = click('fast/go')
      Object.assign(interaction, { createdTimestamp: Date.now() })

      await emit(interaction)
      await vi.advanceTimersByTimeAsync(5_000)

      expect(calls(interaction)).toEqual(['deferUpdate'])
    })

    it('makes a slow command\'s late deferred reply private with ephemeral', async () => {
      vi.useFakeTimers({ now: Date.now() })
      const emit = await startApp()
      let finish!: () => void
      handlerBody = () => new Promise<void>(resolve => (finish = resolve))
      const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'secret-slow', createdTimestamp: Date.now() })
      interaction.options = createChatInputOptions({})

      const done = emit(interaction)
      await vi.advanceTimersByTimeAsync(1_500)
      expect(calls(interaction)[0]).toBe('deferReply')
      expect(Number(payloads(interaction)[0].flags) & Ephemeral).toBe(Ephemeral)
      finish()
      await done
    })

    it('suppresses notifications on new messages when asked', async () => {
      const emit = await startApp()
      handlerBody = async interaction => void (await respond(interaction).followUp({ content: 'note' }))
      const interaction = click('fast/go')
      Object.assign(interaction, { createdTimestamp: Date.now() })

      await emit(interaction)

      expect(payloads(interaction)[0].flags).toBe(SuppressNotifications)
    })
  })

  it('makes a modal under @Defer a clear error, since a modal must be the first response', async () => {
    const emit = await startApp()
    let failure: unknown
    handlerBody = async interaction => {
      await respond(interaction).modal(new ModalBuilder().setCustomId('m').setTitle('T')).catch(error => (failure = error))
    }

    await emit(click('card/refresh'))

    expect(String(failure)).toContain('A modal must be the first response')
    expect(String(failure)).toContain('@Defer acknowledged it')
  })

  describe('at the edges', () => {
    it("shows a modal under mode: 'auto' before the timer, which then never acknowledges", async () => {
      vi.useFakeTimers({ now: Date.now() })
      const emit = await startApp()
      handlerBody = async interaction =>
        respond(interaction).modal(new ModalBuilder().setCustomId('form').setTitle('Form'))
      const interaction = click('ask/go')
      Object.assign(interaction, { createdTimestamp: Date.now() })

      await emit(interaction)
      await vi.advanceTimersByTimeAsync(5_000)

      expect(calls(interaction)).toEqual(['showModal'])
      vi.useRealTimers()
    })

    it("with disable: 'none', acknowledges and never edits the message", async () => {
      const emit = await startApp()
      const interaction = click('quiet/go')

      await emit(interaction)

      expect(calls(interaction)).toEqual(['deferUpdate'])
    })

    it('locks nothing on a component that carries no message', async () => {
      const emit = await startApp()
      const interaction = createMockInteraction(ButtonInteraction, { customId: 'card/refresh' })
      Object.assign(interaction, { message: undefined })

      await emit(interaction)

      expect(calls(interaction)).toEqual(['deferUpdate'])
    })

    it('answers a call a cooldown blocks privately, leaving the card untouched', async () => {
      const emit = await startApp()
      const message = messageWith()
      handlerBody = async () => void log.push('limited')
      const first = click('limited/go', message)
      await emit(first)
      // The same user, whose second click the cooldown counts
      const second = Object.assign(click('limited/go', message), { user: first.user })

      await emit(second)

      expect(calls(second)).toEqual(['deferUpdate', 'followUp'])
      expect(payloads(second)[1].flags).toBe(Ephemeral)
      expect(log.filter(entry => entry === 'limited')).toHaveLength(1)
    })

    it('runs nothing more when the acknowledgement fails because the interaction expired', async () => {
      const emit = await startApp()
      const interaction = click('card/refresh')
      interaction.deferUpdate.mockRejectedValueOnce(createDiscordError(10062))
      let ran = false
      handlerBody = async () => void (ran = true)

      await emit(interaction)

      expect(ran).toBe(false)
      expect(calls(interaction)).toEqual(['deferUpdate'])
    })
  })

  it.each([
    [
      'a reaction',
      () => {
        @Controller()
        class Reactions {
          @Defer()
          @ReactionHandler('👍')
          async like(_reaction: MessageReaction) {}
        }
        return Reactions
      },
      'Reactions.like',
    ],
    [
      'an autocomplete',
      () => {
        @Controller()
        class Suggestions {
          @Command('find', CommandType.SLASH)
          async find(_interaction: ChatInputCommandInteraction) {}

          @Defer()
          @Autocomplete('find')
          async suggest(_interaction: AutocompleteInteraction) {}
        }
        return Suggestions
      },
      'Suggestions.suggest',
    ],
    [
      'an event',
      () => {
        @Controller()
        class Events {
          @Defer()
          @On('guildCreate')
          async joined() {}
        }
        return Events
      },
      'Events.joined',
    ],
  ])('refuses %s handler at decoration, naming its kind', (kind, declare, handler) => {
    expect(declare).toThrow(`${handler}: @Defer is for interaction handlers, and this is ${kind} handler. Remove @Defer from it.`)
  })

  it('accepts a command in a controller that also has message, reaction, autocomplete and event handlers', () => {
    expect(() => {
      @Controller()
      class Mixed {
        @MessageHandler('hi')
        async hi(_message: Message) {}

        @ReactionHandler('👍')
        async like(_reaction: MessageReaction) {}

        @Autocomplete('find')
        async suggest(_interaction: AutocompleteInteraction) {}

        @On('guildCreate')
        async joined() {}

        @Command('find', CommandType.SLASH)
        @Defer()
        async find(_interaction: ChatInputCommandInteraction) {}
      }
      return Mixed
    }).not.toThrow()
  })

  it('refuses a message handler at decoration', () => {
    expect(() => {
      @Controller()
      class Messages {
        @Defer()
        @MessageHandler('hi')
        async hi(_message: Message) {}
      }
      return Messages
    }).toThrow('Messages.hi: @Defer is for interaction handlers, and this is a message handler')
  })
})

describe('@Defer puts back a message the handler answers without editing', () => {
  const option = (value: string, extra: Json = {}) => ({ label: value.toUpperCase(), value, emoji: { name: '⭐' }, ...extra })
  // A card as Discord holds it: its components numbered, a select with one default option, a user select with a default user
  const card = () =>
    createMockMessage({
      id: 'card-message',
      editedTimestamp: 1_700_000_000_000,
      components: [
        {
          type: ComponentType.ActionRow,
          id: 1,
          components: [{ type: ComponentType.Button, id: 2, style: 1, custom_id: 'card/refresh', label: 'Refresh', emoji: { name: '🔄' } }],
        },
        {
          type: ComponentType.ActionRow,
          id: 3,
          components: [
            {
              type: ComponentType.StringSelect,
              id: 4,
              custom_id: 'pick/theme',
              options: [option('light'), option('dark', { default: true }), option('auto')],
            },
          ],
        },
        {
          type: ComponentType.ActionRow,
          id: 5,
          components: [{ type: ComponentType.UserSelect, id: 6, custom_id: 'who/owner', default_values: [{ id: '42', type: 'user' }] }],
        },
      ] as unknown as APIMessageTopLevelComponent[],
    })
  const followUpOnly = async (interaction: unknown) => void (await respond(interaction as ButtonInteraction).followUp({ content: 'Saved.', flags: Ephemeral }))

  /** What the message shows after the call, read back as Discord returns it. */
  const shown = async (interaction: { fetchReply: () => Promise<unknown> }) =>
    ((await interaction.fetchReply()) as Message).components.map(component => component.toJSON() as unknown as Json)
  const disabledIn = (components: Json[]) => JSON.stringify(components).split('"disabled":true').length - 1
  const stripIds = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stripIds)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id').map(([key, entry]) => [key, stripIds(entry)]))
        : value

  it.each([
    ['a button', () => createMockInteraction(ButtonInteraction, { customId: 'card/refresh', message: card() })],
    ['a string select, with the user\'s pick', () => createMockInteraction(StringSelectMenuInteraction, { customId: 'pick/theme', values: ['auto'], message: card() })],
    ['a user select', () => createMockInteraction(UserSelectMenuInteraction, { customId: 'who/owner', values: ['7'], message: card() })],
  ])('after %s whose handler answers only with a follow-up', async (_what, make) => {
    const emit = await startApp()
    handlerBody = followUpOnly
    const interaction = make()

    await emit(interaction)

    expect(calls(interaction)).toEqual(['deferUpdate', 'editReply', 'followUp', 'editReply'])
    // Back as it was before the lock: nothing disabled, the select's options and defaults as the message had them
    const after = await shown(interaction as never)
    expect(disabledIn(after)).toBe(0)
    expect(stripIds(after)).toEqual(stripIds(card().components.map(component => component.toJSON())))
  })

  it('after a handler that returns without answering, and one that throws', async () => {
    const emit = await startApp()
    for (const body of [async () => {}, async () => void Promise.reject(new Error('x')).catch(() => undefined), async () => { throw new Error('broke') }]) {
      handlerBody = body
      const interaction = createMockInteraction(StringSelectMenuInteraction, { customId: 'pick/theme', values: ['light'], message: card() })

      await emit(interaction)

      expect(disabledIn(await shown(interaction as never))).toBe(0)
    }
  })

  // Clicked soon after it was sent, a message with an uploaded file: the lock's edit has Discord process the file
  // again, so the edit's response has it loading, and it has loaded by the restore, with no edit to the message
  it('on a private Components V2 card with an uploaded image, clicked soon after it was sent', async () => {
    const emit = await startApp()
    handlerBody = followUpOnly
    const image = {
      url: 'https://cdn.discordapp.com/attachments/1/2/card.webp?ex=1&is=2&hm=3',
      proxy_url: 'https://media.discordapp.net/attachments/1/2/card.webp?ex=1&is=2&hm=3',
      attachment_id: '1300000000000000001',
      id: '1300000000000000002',
      content_type: 'image/webp',
      width: 1,
      height: 1,
      flags: 0,
      loading_state: 2,
    }
    const message = createMockMessage({
      id: 'private-card',
      flags: Ephemeral | IsComponentsV2,
      editedTimestamp: null,
      components: [
        {
          type: ComponentType.Container,
          id: 1,
          components: [
            { type: ComponentType.TextDisplay, id: 2, content: '### Card' },
            { type: ComponentType.MediaGallery, id: 3, items: [{ media: image }] },
            {
              type: ComponentType.ActionRow,
              id: 4,
              components: [{ type: ComponentType.StringSelect, id: 5, custom_id: 'pick/theme', options: [option('light'), option('dark', { default: true })] }],
            },
          ],
        },
      ] as unknown as APIMessageTopLevelComponent[],
    })
    const interaction = createMockInteraction(StringSelectMenuInteraction, { customId: 'pick/theme', values: ['light'], message })

    await emit(interaction)

    expect(calls(interaction)).toEqual(['deferUpdate', 'editReply', 'followUp', 'editReply'])
    const after = await shown(interaction as never)
    expect(disabledIn(after)).toBe(0)
    // The image kept, and the select with the message's own default rather than the pick
    const container = after[0].components as Json[]
    expect(((container[1].items as Json[])[0].media as Json).url).toBe(image.url)
    expect(((container[2].components as Json[])[0].options as Json[]).map(({ value, default: isDefault }) => [value, isDefault])).toEqual([
      ['light', undefined],
      ['dark', true],
    ])
  })
})
