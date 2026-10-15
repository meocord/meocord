import { type Message } from 'discord.js'
import { Controller, MessageHandler } from '@src/decorator/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'
import { createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

const received: unknown[] = []

@Controller()
class Dice {
  @MessageHandler('roll {sides:int}')
  async roll(_message: Message, params: { sides?: number }) {
    received.push(params)
  }

  @MessageHandler()
  async listen() {
    received.push('listener')
  }
}

const NO_TEXT = "message has no text, so dispatch runs no handler for it: give the mock the content Dice.roll's pattern 'roll {sides:int}' takes."

beforeEach(() => {
  forgetStrictMocks()
  useStrictMocks()
  received.length = 0
})
afterAll(() => forgetStrictMocks())

const compile = () => MeoCordTestingModule.create({ controllers: [Dice] }).compile()

describe('invoke given a message with no text, under useStrictMocks()', () => {
  it.each([
    ['the empty content a strict mock has', createMockMessage],
    ['whitespace only', () => createMockMessage({ content: ' \n ' })],
  ])('rejects %s for a patterned handler, saying what to give the mock', async (_, message) => {
    await expect(compile().invoke(Dice, 'roll', message())).rejects.toThrow(NO_TEXT)
    expect(received).toEqual([])
  })

  it('runs a listener, which it leaves unchecked, and a patterned handler given its content', async () => {
    const module = compile()

    await module.invoke(Dice, 'listen', createMockMessage())
    await module.invoke(Dice, 'roll', createMockMessage({ content: 'roll 6' }))

    expect(received).toEqual(['listener', { sides: 6 }])
  })
})
