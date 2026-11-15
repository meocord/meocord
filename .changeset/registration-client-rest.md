---
'meocord': patch
---

`meocord register` and a process-sharding manager now register through your `clientOptions.rest`, as the bot's own requests always have, so a REST proxy, another `api` or a `timeout` set there applies to registration too. A bot that sets no `rest` option registers exactly as before.
