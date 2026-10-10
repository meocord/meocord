---
'meocord': patch
---

A direct call on a controller, `module.get(Controller).method(interaction)`, runs its guards in the testing module that made the instance. With two modules compiled from one controller, a direct call on the first ran the second module's guard stubs, services and container, since the last compiled module was the only one recorded on the class. A bot has one container, so nothing changes there. See [Testing](https://meocord.dev/docs/4.2/testing).
