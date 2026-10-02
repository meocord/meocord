import { ButtonInteraction } from 'discord.js'
import { Command, Controller, Guard, UseGuard } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type GuardInterface } from '@src/interface/index.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

const seen: unknown[] = []

@Guard()
class ChannelGuard implements GuardInterface {
  declare readonly params?: { channelIds: string[] }
  channelIds?: string[]

  canActivate(): boolean {
    seen.push([this.params, this.channelIds])
    return true
  }
}

@Controller()
class Trade {
  @Command('trade/{id}', CommandType.BUTTON)
  @UseGuard({ provide: ChannelGuard, params: { channelIds: ['1', '2'] } })
  async trade(_interaction: ButtonInteraction) {}
}

describe('a guard with declared params', () => {
  it('reads them whole as this.params, and each as its own property', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Trade] }).compile()

    await module.invoke(Trade, 'trade', createMockInteraction(ButtonInteraction, { customId: 'trade/1' }))

    expect(seen).toEqual([[{ channelIds: ['1', '2'] }, ['1', '2']]])
  })
})
