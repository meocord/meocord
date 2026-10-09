---
'meocord': minor
---

customId patterns take two new param types: `{id:snowflake}` and `{id:uuid}`. The handler gets each as text, typed `string`, and `route().build()` refuses text that isn't one.

- `{id:snowflake}` takes a Discord ID: 17 to 20 digits, up to the largest 64-bit value. Every ID Discord has made since 2015-01-28 has at least 17 digits, because an ID's top 42 bits count milliseconds since 2015-01-01. The handler keeps the ID as text: from 17 digits on, a JavaScript number can't hold it exactly.
- `{id:uuid}` takes a UUID in its canonical 8-4-4-4-12 hex form, in either case, kept as written.

Both rank ahead of an untyped param, so `ticket/{id:snowflake}` takes an ID before `ticket/{name}` does, whatever the listing. Neither shares a value with `int`, `bool` or the other, so they never tie with those. Shorter digits stay an `int` while a JavaScript number holds them exactly. Between a snowflake and a `number` param, which also takes those digits, the snowflake wins.

See https://meocord.dev/docs/4.2/components.
