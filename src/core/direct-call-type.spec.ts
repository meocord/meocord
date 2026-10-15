import { type Message } from 'discord.js'
import { Controller, Guard, On, UseGuard } from '@src/decorator/index.js'
import { type GuardInterface } from '@src/interface/index.js'
import { type ExecutionContextType } from '@src/common/index.js'
import { createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

const log: string[] = []

function denyFor(type: ExecutionContextType) {
  @Guard({ types: [type] })
  class DenyGuard implements GuardInterface {
    canActivate() {
      log.push(`deny ${type}`)
      return false
    }
  }
  return DenyGuard
}

@Controller()
class Listener {
  @On('messageCreate')
  @UseGuard(denyFor('event'))
  async onEvent(_message: Message) {
    log.push('event handler')
  }

  @On('messageCreate')
  @UseGuard(denyFor('message'))
  async onMessage(_message: Message) {
    log.push('message-typed guard skipped')
  }
}

beforeEach(() => {
  log.length = 0
})

describe('a direct call to an event handler', () => {
  it('runs its guards for the event type, as dispatch does', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Listener] }).compile()
    await module.init()

    await module.get(Listener).onEvent(createMockMessage({ content: 'hi' }))
    await module.get(Listener).onMessage(createMockMessage({ content: 'hi' }))

    expect(log).toEqual(['deny event', 'message-typed guard skipped'])
  })

  it('matches dispatch', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Listener] }).compile()
    await module.init()

    await module.emit('messageCreate', createMockMessage({ content: 'hi' }))

    expect(log.sort()).toEqual(['deny event', 'message-typed guard skipped'])
  })
})
