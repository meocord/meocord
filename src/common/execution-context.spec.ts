import { AutocompleteInteraction, ButtonInteraction, Message, MessageReaction } from 'discord.js'
import { createMetadata } from '@src/common/metadata.js'
import { SetMetadata } from '@src/common/decorator.js'
import { HandlerExecutionContext, UnroutedExecutionContext } from '@src/common/execution-context.js'
import { createMockInteraction, createMockMessage } from '@src/testing/index.js'

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
    it('reads an interaction’s second argument, and nothing for a message without one, a reaction or an event', () => {
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

    it("carries one guard's params without changing the call's", () => {
      const context = contextFor(BaseController, 'ban')
      const withParams = context.withParams({ limit: 2 })

      expect(context.getParams()).toBeUndefined()
      expect(withParams.getParams()).toEqual({ limit: 2 })
      expect(withParams.getHandlerName()).toBe('ban')
    })
  })
})
