---
'meocord': minor
---

`route()` in `meocord/common` builds customIds from a component pattern: `const ticket = route('ticket/{id}')` goes to `@Command(ticket, CommandType.BUTTON)` in place of the string, and `ticket.build({ id })` gives `ticket/42`. A missing or unknown param fails to compile. So does a button's or select menu's handler whose params require a key its route does not capture, other than the menu's choices; a modal's fields, and a command's options, are not checked. A `/` or `%` in a value is encoded as `%2F` or `%25`, an empty value or an id over Discord's 100 characters throws, and routes are ranked and checked for duplicates as their pattern strings are. Handlers now receive `%2F` and `%25` in a captured param decoded, for string patterns too.
