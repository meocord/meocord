---
'meocord': patch
---

A controller method that overrides a `@Command` method with a route of another interaction type, and calls the base method through `super`, now runs for its own route. The base method's type check read only the base class's routes, so a button route added by the override was refused with "takes a ChatInputCommandInteraction, not a ButtonInteraction". It now reads the routes of the class the call is made on; the base class on its own still refuses an interaction none of its routes take.
