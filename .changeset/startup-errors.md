---
'meocord': minor
---

`MeoCordFactory.create()` and a testing module's `compile()` report every startup error their checks find, not only the first. These include two handlers of one command, two same-named classes with a cooldown, a provider for a token MeoCord binds itself, and a class nothing can make. Each error is logged with the file it comes from, and then the first is thrown as before: the same error, with the same message, so code and tests that catch it or match its text keep working. A lone error is reported as before.

A decorator's startup error, such as an invalid customId pattern, is still thrown as its class is defined, with its message unchanged. It now names what it is about and where:

- `error.declaration` is the handler or class it was applied to, such as `Tickets.close`;
- `error.file` is the source file it is declared in.

The built bot's report puts the handler first wherever the message doesn't already name it.

New, and opt-in: set `startupErrors: 'all'` in `meocord.config.ts` to report every startup error in one run.

- Decorators keep their errors instead of throwing them as each file loads.
- `create()` logs those together with its own errors, so a bot with three mistakes shows all three in one run.
- In a test, call `reportAllStartupErrors()` from `meocord/testing` in the setup file instead.

The default stays `'first'`, where a decorator throws as its class is defined. The next major version (5.0) makes `'all'` the default. See https://meocord.dev/docs/4.2/configuration.
