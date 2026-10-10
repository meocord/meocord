---
'meocord': patch
---

A customId pattern that repeats a param name, such as `card/{id}/{id}`, or starts one with a digit, such as `card/{1}`, is refused in words that name the param: `Invalid pattern "card/{id}/{id}": {id} appears twice; give each param its own name.` These patterns were already refused, with the regular expression engine's error and the compiled regex in place of the pattern, so only the message changes, for `@Command` and `route()` alike.
