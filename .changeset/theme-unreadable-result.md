---
'meocord': patch
---

A `themeFor` result that throws while MeoCord reads it, such as a plain object with a cycle in it or a database row with a getter that throws, is now left out of the call as a result that isn't a valid theme is: the handler runs without that theme, a warning names the server or user once, and the result is kept for `themeCache.ttlSeconds` like any other. Every call from that server or user used to fail with the error until the app cleared the cache with `ThemeCache`. To use the theme, return a plain object without cycles, such as a row's plain form. See [Theming](https://meocord.dev/docs/4.2/theming).
