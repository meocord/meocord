---
'meocord': minor
---

`meocord/interface` names the options of the stage decorators, `GuardOptions`, `InterceptorOptions`, `ObserverOptions` and `ValidateOptions`, so a decorator of your own that wraps one can type what it passes on, instead of `Parameters<typeof Guard>[0]`. It also exports `PrimaryEntryPointCommandData`, the body an entry point command's builder returns, which could otherwise be written only as `CommandBuildResult<CommandType.PRIMARY_ENTRY_POINT>`.
