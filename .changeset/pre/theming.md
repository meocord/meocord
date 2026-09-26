---
'meocord': minor
---

Add themes: design tokens by role, which `respond()` and MeoCord's own views take their colours, emojis and button styles from, set once for the app and changed per controller, handler, server or user. See [Theming](https://github.com/meocord/meocord/blob/main/README.md#theming).

**What an existing bot sees without changing anything**

- Answers sent through `respond()` with no colour, an embed without `color` or a Components V2 container without `accent_color`, now show the theme's `primary`, `#7680F4` unless the app sets another. A colour that is set is kept, `0` and a `null` accent included, and nothing sent around `respond()` is touched. To send one message as written, pass `{ fill: false }` (`ResponseSendOptions`) as the second argument to `send()`, `edit()` or `followUp()`.
- MeoCord's error view is coloured by the error's tone: `warning` when it is the user's own outcome, such as a denied guard, a cooldown, invalid input or a `UserError`, and `danger` for a fault in the bot. Its loading view uses the theme's loading emoji.
- `Theme` from `meocord/common` is deprecated, and goes in MeoCord 5. Its colours still work: each reads the matching role of the call's theme, so code written against `Theme.primaryColor` follows `@MeoCord({ theme })` and `@UseTheme` with no change, and `errorColor` is the `danger` role. Their values are now the new defaults, tuned for at least 3:1 contrast against every Discord surface: 4.0's were `primaryColor` `#5865F2`, `successColor` `#28A745`, `infoColor` `#17A2B8`, `errorColor` `#DC3545` and `warningColor` `#FFC107`, which `@MeoCord({ theme })` sets again if you want them. Assigning one still recolours MeoCord's views, beneath every theme the app sets, and logs a warning once per colour. See [`Theme` is deprecated, and its colours changed](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#theme-is-deprecated-and-its-colours-changed).
- A presenter from an earlier 4.1 beta gets `context.theme` and the error's `tone`. A spec that builds a `ResponseContext` or a `PresentedError` by hand adds `theme: createMockTheme()` and `tone`.

**What's new**

- **Tokens:** `ThemeColors`, `ThemeEmojis` and `ThemeButtons` in `meocord/interface`, grouped in `MeoCordTheme`, each role with a default. An app adds [tokens of its own](https://github.com/meocord/meocord/blob/main/README.md#adding-tokens-of-your-own) by augmenting them; a bad token stops the bot before it logs in, naming where it was set.
- **Setting and reading:** `@MeoCord({ theme })` for the app, `@UseTheme` for a controller or handler, and `useTheme()` from `meocord/common` to read the call's theme anywhere the call runs, `context.getTheme()` in a stage. `@MeoCord({ themeFor: { guild, user } })` looks a theme up per server and per user, cached, with `ThemeCache` to clear a result when it changes; see [Themes per server and per user](https://github.com/meocord/meocord/blob/main/README.md#themes-per-server-and-per-user).
- **Presenters:** `ResponseContext.theme` and `PresentedError.tone`, so `context.theme.colors[tone]` styles an error by kind.
- **Replies to messages:** `@MeoCord({ messages: { replyEmoji: true } })` starts MeoCord's text replies to message commands with the theme's emoji. It is off by default.
- **Testing:** calls in a testing module run in its theme as in the bot; `overrideTheme`, `overrideThemeFor`, `createMockTheme` and `withTheme` from `meocord/testing` set or check one.
- **New apps:** `meocord create` writes a presenter styled from `context.theme` and `tone`, `src/types/theme.d.ts` for the app's own tokens beside `src/types/assets.d.ts`, and an `eslint.config.ts` that warns on deprecated APIs in app code.
