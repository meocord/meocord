---
'meocord': minor
---

`bindTheme` now runs each call in the theme of the member and server it answers. A function it wraps rebuilds the theme for every call whose arguments name a server or a user, as a handler's call is themed (an interaction, a message, a reaction, a member): MeoCord's defaults and the app's theme, the `@UseTheme` layers of the handler that bound it, then `themeFor`'s layers for that call's server and user, in the order a handler's call has them. A collector's `collect` callback answers each member who clicks in their own theme, and a `client.on(...)` listener bound in one server's call answers every other server in that server's theme, where both used the theme of the member whose call bound them.

A theme `themeFor` is still looking up replaces the handler's once found, so the wrapped function stays synchronous: `respond()` waits for it, and `useTheme()` reads the handler's theme until then. A call whose arguments name neither, such as a collector's `end`, runs in the whole theme of the call that bound it, as before. An app without `themeFor` sees no change. See [Theming](https://meocord.dev/docs/4.3/theming#collectors-and-listeners).
