---
'meocord': minor
---

`MeoCordTestingModule.fromApp(App, options?)` builds a testing module from a whole `@MeoCord` app, wired as the bot wires it: its controllers, services, providers and cooldown store, with its stages, translator, presenter, message options, theme and observers. A test no longer lists the app's controllers and providers again. `options.providers` replaces the app's by token, before anything is made, so a database factory the test replaces never runs; `options.controllers` and `options.observers` add a test's own; the `override*()` methods still apply. The app's services are made at `init()`, as the bot makes them before it logs in.

A class that injects the Discord `Client` in a testing module that was given none is now refused with what to do, `{ provide: Client, useValue: createMockClient() }`, where it read `No bindings found for service: "Client"`.
