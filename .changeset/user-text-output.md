---
'meocord': patch
---

How MeoCord logs and echoes what users send:

- **Autocomplete and reactions log their users' outcomes at debug level**, as commands do. An autocomplete call that a guard denies, or whose handler throws a `UserError` or a `ValidationError`, still closes its menu, and is no longer logged as an error with its stack. The same holds for a guard that denies a reaction. `TestingModule.dispatch` resolves for such an autocomplete call, where it rejected.
- **Log lines quote what a user sent on one line.** A message's text, a reaction's emoji and a component's customId are quoted with line breaks, control characters and quotes escaped, and a message's text is cut short after 200 characters, with its length. So are the messages of the debug lines for a refused, denied or invalid call.
- **Usage and help replies show the user's words as typed.** A param's value, a flag's name or value, and the command a `help` query names are quoted with their markdown escaped and on one line, so `**up**` or `[text](https://example.com)` reads as written instead of rendering as bold text or a link.
