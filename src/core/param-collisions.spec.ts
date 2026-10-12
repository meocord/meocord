import { ModalSubmitInteraction, StringSelectMenuInteraction } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { Command, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMockInteraction, createModalFields, MeoCordTestingModule } from '@src/testing/index.js'

let warned: string[]
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development')
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => void warned.push(args.map(String).join(' ')))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

/** The collision warnings logged so far. */
const collisions = () => warned.filter(line => line.includes('is both a customId param'))

const warning = (name: string, handler: string) =>
  `"${name}" is both a customId param and a modal field or select menu choice of ${handler}; the handler receives the customId param. Rename one to receive both.`

const select = (customId: string) => createMockInteraction(StringSelectMenuInteraction, { customId, values: ['a'] })

describe('customId param collision warning', () => {
  it('warns once for each controller whose method collides, naming the controller', async () => {
    @Controller()
    class Shop {
      @Command('shop/{values}', CommandType.SELECT_MENU)
      async pick() {}
    }
    @Controller()
    class Roles {
      @Command('roles/{values}', CommandType.SELECT_MENU)
      async pick() {}
    }
    const module = MeoCordTestingModule.create({ controllers: [Shop, Roles] }).compile()

    await module.dispatch(select('shop/x'))
    await module.dispatch(select('roles/y'))
    await module.dispatch(select('shop/z'))
    await module.dispatch(select('roles/w'))

    expect(collisions()).toEqual([warning('values', 'Shop.pick'), warning('values', 'Roles.pick')])
  })

  it('keeps two controllers of one name apart', async () => {
    const make = (prefix: string) => {
      @Controller()
      class Picker {
        @Command(`${prefix}/{values}`, CommandType.SELECT_MENU)
        async pick() {}
      }
      return Picker
    }
    const module = MeoCordTestingModule.create({ controllers: [make('a'), make('b')] }).compile()

    await module.dispatch(select('a/x'))
    await module.dispatch(select('b/y'))

    expect(collisions()).toEqual([warning('values', 'Picker.pick'), warning('values', 'Picker.pick')])
  })

  it('names the controller for a modal field collision', async () => {
    @Controller()
    class Feedback {
      @Command('feedback/{topic}', CommandType.MODAL_SUBMIT)
      async submit() {}
    }
    const module = MeoCordTestingModule.create({ controllers: [Feedback] }).compile()
    const modal = () => createMockInteraction(ModalSubmitInteraction, { customId: 'feedback/bugs', fields: createModalFields({ topic: 'typed' }) })

    await module.dispatch(modal())
    await module.dispatch(modal())

    expect(collisions()).toEqual([warning('topic', 'Feedback.submit')])
  })
})
