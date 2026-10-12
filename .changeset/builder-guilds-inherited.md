---
'meocord': patch
---

A `@CommandBuilder` that extends another builder and gives no `guilds` inherits its base's, so its command registers only in those servers. It now warns when the class is decorated, naming both classes; where the command registers is unchanged. Declare `guilds` on the subclass to keep them: the next major version (5.0) registers such a builder's command in the configured scope.
