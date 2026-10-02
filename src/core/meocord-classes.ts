import { CooldownStore } from '@src/common/cooldown-store.js'
import { Translator } from '@src/common/translator.js'
import { HandlerRegistry } from '@src/core/handler-registry.js'
import { ShardContext } from '@src/core/shard-context.js'
import { ThemeCache } from '@src/core/theme-resolvers.js'

/** The classes MeoCord binds itself, which an app's class may inject but MeoCord makes, never from their decorators. */
export const meocordClasses = (): readonly unknown[] => [CooldownStore, HandlerRegistry, ShardContext, ThemeCache, Translator]
