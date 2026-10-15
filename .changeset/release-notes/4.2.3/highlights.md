### Highlights

- **Stopping during startup is clean.** A Ctrl+C, SIGTERM or `app.stop()` before the bot is online exits 0 (your own `app.stop()` once `main.ts` is updated, see Upgrading) and closes what the startup made, such as a connection pool a provider opened. A start that fails closes what it made too, so the process can end ([docs](https://meocord.dev/docs/4.2/lifecycle-hooks)).
- **`@On` and `@Once` reach every instance the app makes,** including a service only a guard or the presenter injects, a provider's `useClass`, `useValue` or `useFactory`. They were never attached there ([docs](https://meocord.dev/docs/4.2/gateway-events)).
- **Clearer message command replies.** The usage reply names the word a message left out or got wrong, quotes it as typed, and a pattern's own `--word` is matched where the pattern has it ([docs](https://meocord.dev/docs/4.2/message-commands)).
- **Mocks closer to discord.js.** Mocks fill in more of what Discord always sends, in both modes, and `useStrictMocks()` covers about twenty more behaviours that 5.0 makes the default. Upgrading your tests, below, lists them ([docs](https://meocord.dev/docs/4.2/mocks)).
- **One process, two builds.** A bot whose dependencies load both MeoCord's ES module and CommonJS builds shares one theme, one shutdown, one set of warnings and one exit code between them.
