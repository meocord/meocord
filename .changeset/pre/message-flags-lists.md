---
'meocord': minor
---

Message patterns take flags and typed lists. `{--bots}` is `true` when a message gives `--bots` anywhere after the command word, and `false` when it does not; `{--from:user?}` takes `--from=@ana`, resolved as a typed param is, and is required without the `?`. `{options:string...}` gives the rest of the message as a list, one item per word or "quoted words", and `{targets:member...}` a list of members, fetched with the message's other members in one request. A flag the command does not have, a typed flag missing or given no value, and a list item of the wrong type each get the usage reply. `ParamsOf` types flags as `boolean` or their value, and typed lists as arrays. Only a message naming a command with flags is read for them, so a pattern without flags reads `--bots` as an ordinary word, as before, and `{name...}` without a type stays the rest of the message as text.
