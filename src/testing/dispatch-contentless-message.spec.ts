import { type Message } from 'discord.js'
import { Controller, MessageHandler } from '@src/decorator/index.js'
import { Logger } from '@src/common/logger.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'
import { createMockMessage, MeoCordTestingModule } from './index.js'

const received: string[] = []

@Controller()
class Chat {
  @MessageHandler()
  async listen(message: Message) {
    received.push(message.content)
  }
}

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  received.length = 0
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const compile = () => MeoCordTestingModule.create({ controllers: [Chat] }).compile()

describe('dispatch given a mock message made without content', () => {
  it('runs nothing in default mode, where the content is a placeholder, and says nothing', async () => {
    await expect(compile().dispatch(createMockMessage())).resolves.toEqual({ ran: false, handlers: [] })

    expect(received).toEqual([])
    expect(warned).toEqual([])
  })

  it('runs nothing under useStrictMocks(), where the content is empty', async () => {
    useStrictMocks()

    await expect(compile().dispatch(createMockMessage())).resolves.toEqual({ ran: false, handlers: [] })
    expect(received).toEqual([])
  })

  it('still runs a listener for a message with content, in default mode', async () => {
    await compile().dispatch(createMockMessage({ content: 'hello' }))

    expect(received).toEqual(['hello'])
  })
})
