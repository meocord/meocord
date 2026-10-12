---
'meocord': patch
---

A handler decorator on a static method, such as `@Command`, `@MessageHandler`, `@On` or `@Validate`, now warns as the class is decorated: "`St.ping`: @Command goes on an instance method, not a static one; it never runs." Its metadata lands on the class, where nothing reads it, so the handler never ran and nothing said so. Move it to an instance method. `@Inject` on a static property warns the same way. The next major version (5.0) refuses it. A refusal raised on a static member, such as an invalid `@UseTheme`, now names its class rather than `Function`.
