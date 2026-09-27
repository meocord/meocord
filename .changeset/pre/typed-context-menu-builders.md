---
'meocord': minor
---

A context menu handler is typed with the kind its builder's `setType()` names. With `.setType(ApplicationCommandType.User)`, `@Command('Report user', ReportUserBuilder)` gives the handler a `UserContextMenuCommandInteraction`, and a handler declaring `MessageContextMenuCommandInteraction` no longer compiles. It is caught however the interaction is imported, an `import { type … }` included, where the check as the bot starts needed it imported as a value. Such a handler was broken anyway: dispatch sends a builder's command only to a handler of its kind, so its first click already failed. Declare the kind the builder's `setType()` names.

Nothing new is needed: MeoCord adds the kind to discord.js's `ContextMenuCommandBuilder.setType` for the compiler alone, and nothing changes at runtime. A builder whose kind the compiler can't tell, one that never calls `setType()` or picks the kind at runtime, gives either kind as before, and is still checked as the bot starts.
