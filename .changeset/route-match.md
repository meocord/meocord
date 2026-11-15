---
'meocord': minor
---

A `route()` can now read a customId back: `route('ticket/{id:int}/close').match('ticket/42/close')` returns `{ id: 42 }`, the params its handler would receive. Use it for a customId the bot did not get as a handler call, such as the other buttons on a message or an id kept in a database. A value `build` encoded with `/` or `%` comes back as it was given, and a typed param comes back as its value. `match` returns `undefined` for a customId that doesn't match, and an empty object for a matching route without params. It reads that one route, so a customId it matches can still go to a more specific pattern in your app. See [Buttons, selects and modals](https://meocord.dev/docs/4.3/components).

The new `RouteMatch<T>` type, from `meocord/common`, is what `match` returns: the params a customId route gives its handler. It can type a handler's params too, such as `{ id }: RouteMatch<typeof closeTicket.pattern>`.

`Route` gains the required `match` method. A bot that only calls `route()` needs nothing. Code that writes a `Route` object by hand no longer compiles until it adds `match(customId: string)`, returning the params or `undefined`; make the object with `route()` instead. See the [upgrade guide](https://meocord.dev/docs/4.3/migrating).
