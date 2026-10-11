---
'meocord': patch
---

`@On` and `@Once` handlers now run on every instance whose lifecycle hooks run, as the [Gateway events](https://meocord.dev/docs/4.2/gateway-events) guide says they do. A service only a guard, interceptor, filter, pipe or the presenter injects, a class given as `useClass` under another token, and a `useValue` or `useFactory` instance whose class declares them receive their events, on the bot and through the testing module's `emit`. They were never attached, and nothing said so.

- One instance that several tokens reach runs its handlers once. The cooldown store still receives no events.
- The intents check and the note on global stages cover these handlers too, and `HandlerRegistry.list({ kind: 'event' })` lists them, with the class they are on.
- Handlers for one event are attached in lifecycle order, each class after what it injects. A test that relied on the order of two listeners of one event can see them swap.
- A handler on one of these classes that a listed service's would be refused for (`@Defer`, `@Validate`, `@UsePipe` or `@Cooldown` on it, or an `@Once` on a class sharing another's name) logs a warning naming the refusal and does not run. The next major version (5.0) refuses it at startup.
- An `@On` or `@Once` on a class made for each call, as it injects `ExecutionContext`, has no one instance to receive events. Startup now warns about it; 5.0 refuses it. Move the handler to a service that doesn't inject it.
