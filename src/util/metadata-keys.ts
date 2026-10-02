import { MetadataKey } from '@src/enum/metadata-key.enum.js'

/**
 * Every reflect-metadata key MeoCord keeps its own metadata under, each beginning `meocord:`, so a key of the app's
 * own, such as one `SetMetadata` stores, never meets one of them. The four `MetadataKey` publishes are the same keys.
 */
export const META = {
  /** The `@MeoCord()` options, on the app class. */
  appOptions: MetadataKey.AppOptions,
  /** The container that made a class, on the class. */
  container: MetadataKey.Container,
  /** The guards dispatch runs before a method, published on the method in the order they run. */
  guards: MetadataKey.Guards,
  /** The `CommandType` of a `@CommandBuilder` class. */
  commandType: MetadataKey.CommandType,
  /** A builder class's `guilds` option, which `@Command` copies into the handler's metadata. */
  builderGuilds: 'meocord:builder-guilds',

  /** A class's `@Command` handlers, by command name or customId pattern. */
  commands: 'meocord:commands',
  /** A class's `@MessageHandler` handlers. */
  messageHandlers: 'meocord:message-handlers',
  /** A class's `@ReactionHandler` handlers. */
  reactionHandlers: 'meocord:reaction-handlers',
  /** A class's `@Autocomplete` handlers. */
  autocompleteHandlers: 'meocord:autocomplete-handlers',
  /** A class's `@On` and `@Once` handlers. */
  eventHandlers: 'meocord:event-handlers',
  /** The routes a class's own handler decorators declare, by method, beside those it inherits. */
  declaredRoutes: 'meocord:declared-routes',

  /** Marks a class `@Guard` decorated. */
  guardClass: 'meocord:guard-class',
  /** The guards a class-level `@UseGuard` declares, kept on the class. */
  classLevelGuards: 'meocord:class-level-guards',
  /** The guards a class-level `@UseGuard` applies to one method, in the order they run. */
  classGuards: 'meocord:class-guards',
  /** The guards of the classes a class extends that `@Controller` applies to one of its own handlers. */
  inheritedGuards: 'meocord:inherited-guards',
  /** How many of an inherited handler's class guards came from the classes it extends, which run before the class's own. */
  baseClassGuards: 'meocord:base-class-guards',
  /** The guards method-level `@UseGuard` applies to one method, in the order they run. */
  methodGuards: 'meocord:method-guards',
  /** How many guard wrappers `@UseGuard` and `@Controller` put around one method. */
  guardWrappers: 'meocord:guard-wrappers',
  /** The prototype whose method a class-level `@UseGuard` re-declared on a subclass. */
  inheritedFrom: 'meocord:inherited-from',
  /** `false` when `@Controller({ inheritStages: false })` stops class stages at this class. */
  inheritStages: 'meocord:inherit-stages',

  /** A controller's class-level `@Cooldown`s. */
  classCooldowns: 'meocord:class-cooldowns',
  /** A method's `@Cooldown`s, in declaration order. */
  methodCooldowns: 'meocord:method-cooldowns',
  /** The error types a filter's `@Catch` names; empty to catch everything. */
  catchTypes: 'meocord:catch-types',
  /** The filters a class-level `@UseFilter` applies, on the class. */
  classFilters: 'meocord:class-filters',
  /** The filters a method-level `@UseFilter` applies, on the method. */
  methodFilters: 'meocord:method-filters',
  /** The interceptors a class-level `@UseInterceptor` applies, on the class. */
  classInterceptors: 'meocord:class-interceptors',
  /** The interceptors a method-level `@UseInterceptor` applies, on the method. */
  methodInterceptors: 'meocord:method-interceptors',
  /** The `@Validate` schema and inline pipes of a method. */
  methodValidation: 'meocord:method-validation',
  /** The `@UsePipe` pipes of a method, in declaration order. */
  methodPipes: 'meocord:method-pipes',
  /** Marks a class `@Observer` decorated. */
  observerClass: 'meocord:observer-class',
  /** The context types a guard, interceptor or observer class declared it runs for, such as `@Guard({ types })`. */
  stageTypes: 'meocord:stage-types',
  /** A handler's `@Defer` options. */
  deferOptions: 'meocord:defer-options',
  /** The theme layer a class-level `@UseTheme` sets, kept on the class. */
  classTheme: 'meocord:class-theme',
  /** The theme layer a method-level `@UseTheme` sets. */
  methodTheme: 'meocord:method-theme',
} as const

/** One of MeoCord's own metadata keys. */
export type MetaKey = (typeof META)[keyof typeof META]
