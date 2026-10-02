import { ButtonInteraction } from 'discord.js'
import { GuardDeniedError } from 'meocord/common'
import { Command, Controller, UseGuard } from 'meocord/decorator'
import { CommandType } from 'meocord/enum'
import { createMockInteraction, createMockUser, MeoCordTestingModule } from 'meocord/testing'
import { OwnerGuard } from '@src/guards/owner.guard.js'

@Controller()
class CardController {
  @Command('card/{ownerId}', CommandType.BUTTON)
  @UseGuard(OwnerGuard)
  async open(interaction: ButtonInteraction) {
    await interaction.deferUpdate()
  }
}

const clickBy = (userId: string) => {
  const user = createMockUser()
  user.id = userId
  // invoke reads ownerId from the customId, as dispatch does
  return createMockInteraction(ButtonInteraction, { customId: 'card/owner', user })
}

describe('OwnerGuard', () => {
  const module = MeoCordTestingModule.create({ controllers: [CardController] }).compile()

  it("lets the button's owner through", async () => {
    const { ran } = await module.invoke(CardController, 'open', clickBy('owner'))

    expect(ran).toBe(true)
  })

  it('denies anyone else with a GuardDeniedError', async () => {
    await expect(module.invoke(CardController, 'open', clickBy('stranger'))).rejects.toThrow(GuardDeniedError)
  })
})
