---
'meocord': patch
---

Where a message command with a `member`, `role` or `channel` flag works now reads the same in dispatch, the built-in help, `HandlerRegistry` and `resolveRoute`:

- A command whose only such flags are optional, such as `post {text...} {--in:channel?}`, runs in a DM when the flag is left out, as it did. Help now lists it in a DM and no longer says "Works in servers only.", and `HandlerRegistry` gives it `scope: 'any'`.
- A command with a required such flag, such as `pin {text...} {--in:channel}`, works in servers only. A DM that leaves the flag out is now answered "This command works in a server only.", the reply it already got with the flag, rather than its usage.
- `resolveRoute(App, { content, dm: true })` returns a command with a required such flag, or one whose message gives such a flag, with a warning once: dispatch refuses both in a DM. Under `useStrictMocks()` it returns `undefined` for them, as it will in the next major version (5.0).

`scope: 'dm'` with any such flag, optional or not, is still refused at startup.
