---
'meocord': patch
---

A `@MessageHandler` pattern refused at startup now names the rule it breaks, and quotes its params as written:

- A whole brace pair with a name the syntax doesn't take, such as `{user-id}` or `{café}`, reads `"{user-id}" is not a param: a param's name is ASCII letters, digits and _, such as {user_id}.`; a flag's, such as `{--dry-run}`, reads `"{--dry-run}" is not a flag: a flag's name starts with a letter, then letters, digits or _, such as {--dry_run}.`; and a type that isn't one, such as `{m:a|}`, reads `"{m:a|}" is not a param: a type is a name, or words to choose from joined by |, such as {m:on|off}.` Each was told it wasn't a whole word. Text around braces, as in `a{b}`, keeps that message.
- The refusal of a required word after an optional param quotes both as written, as in `{a:int?} is optional, so only optional params may follow it; "{b...}" is not.`, and `scope: 'dm'` with a server-only flag quotes it as written, `{--in:channel?}`.
