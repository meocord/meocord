import { GatewayIntentBits, Partials } from 'discord.js'
import { MeoCord } from 'meocord/decorator'
import { SmokeController } from '@src/controllers/smoke.controller'
import { CardController } from '@src/controllers/card.controller'
import { ResponderController } from '@src/controllers/responder.controller'
import { ThemeResponderController } from '@src/controllers/theme-responder.controller'
import { ThemeShowcaseController } from '@src/controllers/theme-showcase.controller'
import { ProbeService } from '@src/services/probe.service'
import { APP_THEME, GUILD_THEME, USER_THEME } from '@src/theme-showcase'

const manual = process.env.MEOCORD_E2E_MODE === 'manual'
const guildId = process.env.MEOCORD_E2E_GUILD_ID
// The helper bot's id, which scripts/e2e.ts passes when it has one, so its messages carry a user's theme
const themedUserId = process.env.MEOCORD_E2E_THEMED_USER_ID

@MeoCord({
  // The responders serve the manual checklist; the automated checks register only the smoke command
  controllers: manual ? [SmokeController, ThemeShowcaseController, ResponderController, CardController, ThemeResponderController] : [SmokeController, ThemeShowcaseController],
  services: [ProbeService],
  clientOptions: {
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Reaction],
  },
  theme: APP_THEME,
  themeFor: {
    guild: ({ guild }) => (guild.id === guildId ? GUILD_THEME : undefined),
    user: ({ user }) => (user.id === themedUserId ? USER_THEME : undefined),
  },
  messages: { replyEmoji: true },
})
export default class App {}
