---
'meocord': minor
---

`@MeoCord({ themeFor })` takes a class implementing the new `ThemeResolver` interface, so a theme can be looked up with the app's services, such as a user's saved choice in a database a provider connects. Its `guild()` and `user()` methods are optional and typed as the functions are. The class is resolved from the app's container like the cooldown store: it isn't listed in `providers`, its constructor injects the app's services and providers, and it runs `OnReady` and `OnShutdown` in dependency order. Its results are cached, timed out and logged as the functions' are, and `ThemeCache` clears them. In tests, `fromApp` binds it, `overrideProvider` replaces it or what it injects, and `overrideThemeFor` takes a class too. See [Theming](https://meocord.dev/docs/4.1/theming).
