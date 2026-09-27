/**
 * The stand-ins a JSDoc `@example` may name without declaring, as a dependency: a stage it applies or a service it
 * injects, never one it extends. Each means what the guide's example of the same name does. `check:jsdoc-examples` compiles this file against the built package with the examples.
 */

import { type ChatInputCommandInteraction, EmbedBuilder } from 'discord.js'
import { CooldownError, type ExecutionContext, Logger } from 'meocord/common'
import { Catch, Guard, Interceptor, Pipe, Service } from 'meocord/decorator'
import { type CallHandler, type ExceptionFilter, type GuardInterface, type InterceptorInterface, type PipeInterface } from 'meocord/interface'

/** Lets a call through when its member has a staff role. */
@Guard()
export class StaffGuard implements GuardInterface {
  canActivate(interaction: ChatInputCommandInteraction): boolean {
    return interaction.inCachedGuild() && interaction.member.roles.cache.some(role => role.name === 'Staff')
  }
}

/** Lets a call through in the channels its params name. */
@Guard()
export class ChannelGuard implements GuardInterface {
  declare readonly params?: { channelIds: string[] }

  canActivate(interaction: ChatInputCommandInteraction): boolean {
    return this.params?.channelIds.includes(interaction.channelId) ?? true
  }
}

/** Renders a user's profile card. */
@Service()
export class ProfileService {
  async render(userId: string): Promise<EmbedBuilder> {
    return new EmbedBuilder().setTitle(`Profile of ${userId}`)
  }
}

/** Logs how long the handler took. */
@Interceptor()
export class TimingInterceptor implements InterceptorInterface {
  private readonly logger = new Logger(TimingInterceptor.name)

  async intercept(context: ExecutionContext, next: CallHandler): Promise<unknown> {
    const started = performance.now()
    try {
      return await next.handle()
    } finally {
      this.logger.log(`${context.getHandlerName()} took ${Math.round(performance.now() - started)} ms`)
    }
  }
}

/** Answers a call on cooldown with how long to wait. */
@Catch(CooldownError)
export class CooldownFilter implements ExceptionFilter<CooldownError> {
  async catch(error: CooldownError, context: ExecutionContext): Promise<void> {
    await context.response?.error(error, { message: `Try again in ${Math.ceil(error.retryAfterMs / 1000)}s.` })
  }
}

/** Trims a string. */
@Pipe()
export class TrimPipe implements PipeInterface<string, string> {
  transform(value: string): string {
    return value.trim()
  }
}
