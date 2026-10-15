import { AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction, Message, MessageReaction } from 'discord.js'
import { createMetadata } from '@src/common/metadata.js'
import { SetMetadata } from '@src/common/decorator.js'
import { ExecutionContext, HandlerExecutionContext, UnroutedExecutionContext } from '@src/common/execution-context.js'
import { responsePhaseOf } from '@src/core/observer-runner.js'
import { Guard, MeoCord, Observer, On, Service, UseGuard } from '@src/decorator/index.js'
import { type DispatchResult } from '@src/interface/index.js'
import { createMockInteraction, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

const Roles = createMetadata<string[]>('roles')

@Roles(['moderator'])
class BaseController {
  @Roles(['admin'])
  ban() {}

  kick() {}
}

@Roles(['helper'])
class ChildController extends BaseController {
  @SetMetadata('legacy', 'method')
  warn() {}
}

const contextFor = (controller: new () => unknown, methodName: string, args: unknown[] = []) =>
  new HandlerExecutionContext({ controller, methodName, args })

describe('createMetadata', () => {
  it('stores each value under its own Symbol, named by the description', () => {
    const Other = createMetadata<string[]>('roles')

    expect(typeof Roles.key).toBe('symbol')
    expect(Roles.key.description).toBe('roles')
    expect(Roles.key).not.toBe(Other.key)
    expect(Reflect.getMetadata(Roles.key, BaseController.prototype, 'ban')).toEqual(['admin'])
    expect(Reflect.getMetadata(Roles.key, BaseController)).toEqual(['moderator'])
  })
})

describe('ExecutionContext', () => {
  describe('get / getAll', () => {
    it('prefers the method value over the controller value', () => {
      expect(contextFor(BaseController, 'ban').get(Roles)).toEqual(['admin'])
      expect(contextFor(BaseController, 'ban').getAll(Roles)).toEqual([['admin'], ['moderator']])
    })

    it('falls back to the controller value', () => {
      expect(contextFor(BaseController, 'kick').get(Roles)).toEqual(['moderator'])
    })

    it("reads an inherited handler's base method value before the subclass's class value", () => {
      expect(contextFor(ChildController, 'ban').get(Roles)).toEqual(['admin'])
      expect(contextFor(ChildController, 'kick').get(Roles)).toEqual(['helper'])
    })

    it('reads SetMetadata string keys', () => {
      expect(contextFor(ChildController, 'warn').get<string>('legacy')).toBe('method')
      expect(contextFor(ChildController, 'kick').get('legacy')).toBeUndefined()
      expect(contextFor(ChildController, 'kick').getAll('legacy')).toEqual([])
    })
  })

  describe('getHandlerParams', () => {
    it('reads an interaction’s second argument, and none for a bare message, a reaction or an event', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      const reaction = Object.create(MessageReaction.prototype) as MessageReaction

      expect(contextFor(BaseController, 'ban', [interaction, { uid: '1' }]).getHandlerParams()).toEqual({ uid: '1' })
      expect(contextFor(BaseController, 'ban', [createMockMessage()]).getHandlerParams()).toBeUndefined()
      expect(contextFor(BaseController, 'ban', [reaction, { user: {}, action: 'add' }]).getHandlerParams()).toBeUndefined()
      expect(contextFor(BaseController, 'ban', [{ id: 'member' }, { id: 'other' }]).getHandlerParams()).toBeUndefined()
    })

    it('is undefined for a call no handler was reached for', () => {
      const interaction = createMockInteraction(ButtonInteraction)

      expect(new UnroutedExecutionContext([interaction, { uid: '1' }]).getHandlerParams()).toBeUndefined()
    })
  })

  describe('the call', () => {
    it('describes the handler', () => {
      const context = contextFor(BaseController, 'ban')

      expect(context.getController()).toBe(BaseController)
      expect(context.getHandlerName()).toBe('ban')
      expect(context.getHandler()).toBe(BaseController.prototype.ban)
    })

    it('reads the type and the typed argument from the first argument', () => {
      const button = createMockInteraction(ButtonInteraction)
      const autocomplete = createMockInteraction(AutocompleteInteraction)
      const message = createMockMessage()
      const reaction = Object.create(MessageReaction.prototype) as MessageReaction

      const forButton = contextFor(BaseController, 'ban', [button, {}])
      expect(forButton.getType()).toBe('interaction')
      expect(forButton.getInteraction()).toBe(button)
      expect(forButton.getMessage()).toBeUndefined()
      expect(forButton.getArgs()).toEqual([button, {}])

      expect(contextFor(BaseController, 'ban', [autocomplete]).getType()).toBe('autocomplete')

      const forMessage = contextFor(BaseController, 'ban', [message])
      expect(forMessage.getType()).toBe('message')
      expect(forMessage.getMessage()).toBe(message)
      expect(message).toBeInstanceOf(Message)

      const forReaction = contextFor(BaseController, 'ban', [reaction])
      expect(forReaction.getType()).toBe('reaction')
      expect(forReaction.getReaction()).toBe(reaction)
      expect(forReaction.getInteraction()).toBeUndefined()
    })

    it("gives an event's stages the interaction or message the event carries, and no answer to give", () => {
      const button = createMockInteraction(ButtonInteraction)
      const message = createMockMessage()
      const onInteraction = new HandlerExecutionContext({ controller: BaseController, methodName: 'ban', args: [button], type: 'event' })
      const onMessage = new HandlerExecutionContext({ controller: BaseController, methodName: 'ban', args: [message], type: 'event' })

      expect([onInteraction.getType(), onInteraction.getInteraction(), onInteraction.response, responsePhaseOf(onInteraction)]).toEqual([
        'event',
        button,
        undefined,
        undefined,
      ])
      expect([onMessage.getMessage(), onMessage.response]).toEqual([message, undefined])
    })

    it('answers an interaction a handler is called for', () => {
      const slash = createMockInteraction(ChatInputCommandInteraction)
      const context = contextFor(BaseController, 'ban', [slash, {}])

      expect([context.response !== undefined, responsePhaseOf(context)]).toEqual([true, 'unanswered'])
    })

    it("carries one guard's params without changing the call's", () => {
      const context = contextFor(BaseController, 'ban')
      const withParams = context.withParams({ limit: 2 })

      expect(context.getParams()).toBeUndefined()
      expect(withParams.getParams()).toEqual({ limit: 2 })
      expect(withParams.getHandlerName()).toBe('ban')
    })
  })
})

describe('an @On handler for an interaction or a message', () => {
  it('gives its guard the event\'s interaction but no response, and its observers no answer phase', async () => {
    const seen: unknown[] = []
    @Guard()
    class Peek {
      constructor(private readonly context: ExecutionContext) {}
      canActivate() {
        seen.push({ interaction: this.context.getInteraction() !== undefined, response: this.context.response })
        return true
      }
    }
    @Observer()
    class Settled {
      onSettled(_context: ExecutionContext, { response }: DispatchResult) {
        seen.push({ phase: response })
      }
    }
    @Service()
    class Watch {
      @On('interactionCreate')
      @UseGuard(Peek)
      heard() {}
    }
    @MeoCord({ controllers: [], services: [Watch], observers: [Settled], clientOptions: { intents: [] } })
    class App {}

    await MeoCordTestingModule.fromApp(App).compile().emit('interactionCreate', createMockInteraction(ChatInputCommandInteraction))

    expect(seen).toEqual([{ interaction: true, response: undefined }, { phase: undefined }])
  })
})
