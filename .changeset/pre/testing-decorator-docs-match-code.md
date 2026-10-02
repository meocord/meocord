---
'meocord': patch
---

The documentation your editor shows for `meocord/testing` and `meocord/decorator` now matches what the code does. Nothing to change in your code.

- **Mocks:** `createMockClient` says only a mock message gets a client of its own; give an interaction its `client` when the code under test reaches it. `createMockGuild` says what a manager's `fetch(id)` makes: a member or channel in the guild, a role with that id, or a ban. `createMockUser` is for a user, and `MockProps` names only a property the mock does not let you assign. `createMock`, `createMockGuild` and `createChatInputOptions` document their parameter.
- **Testing module:** the `invoke`, `themeCache` and `overrideThemeFor` examples compile, and `expectCompleteCatalog`'s example passes. `observers` and `init()` name `dispatch` beside `invoke` and `emit`. `inspectHandler`'s `app` says the app's filters are tried after the handler's own. `resolveRoute`'s `dm` says when a handler outside its scope is returned. A `testCooldownStore` case title claims only what it checks.
- **Decorators:** `@Cooldown`, `@Validate` and `cooldownStoreFailure` say how a message command over its limit, with invalid input or with the store down is answered. `@Defer` describes `mode: 'auto'` and when a misplaced `@Defer` is refused. `@Service` says when to list a class in `services`. `@Controller` says which handlers its class stages reach. `@Command` lists everything it refuses as it applies, and `@Autocomplete` says a handler's own guards run. `@Guard`, `@Interceptor`, `@Observer` and `@Validate` document their options.
