---
'meocord': patch
---

`ShardContext.call` fixes:

- **Identical concurrent calls run once each.** With process sharding, two identical calls made at once, such as two users triggering the same announcement, used to run once in each shard and share one answer, and a later identical call could get an earlier call's answer. Each call now runs in every shard and gets its own answer.
- **One process and tests now pass values as JSON, as process sharding does.** In one process, which is how `meocord start --dev` and the testing module run, the arguments and the result were passed as live objects, while process sharding sends them as JSON. A `Date` arrived as a `Date` in development and tests, then as a string in production, and a returned `Map` arrived as `{}`. They're now passed through JSON in every mode, so a test sees what production gets.
- **A class a provider stands in for can be called.** `call(Payments, 'charge')` with `providers: [{ provide: Payments, useClass: StripePayments }]` answered "Payments is not a controller or service of this app." It now runs `StripePayments.charge`. With process sharding, a call from another shard names the class, so the bot refuses to start when a provided class shares a name with a controller, a service or another provided class, as it already did for two controllers or services.
