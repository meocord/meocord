---
'meocord': patch
---

A class-level `@UseGuard` now also guards the handlers a controller inherits. On a controller that extends another, the subclass's guards were applied only to the handlers it declared itself, so inherited commands, components, message and reaction handlers ran without them. They now run the subclass's guards first, then the base class's, then the method's, whether dispatched, called directly or run with `TestingModule.invoke`.

This changes which guards run for inherited handlers. If your bot relied on an inherited handler skipping the subclass's guards, see [Class guards now cover inherited handlers](https://meocord.dev/docs/4.1/migrating#class-guards-now-cover-inherited-handlers).
