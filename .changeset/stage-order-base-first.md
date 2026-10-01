---
'meocord': patch
---

A base controller's class stages now wrap the classes that extend it, as global stages wrap controllers. Guards and interceptors run the top base's first, then each subclass's, then the method's. Filters are tried the other way: the method's, then the subclass's, then each base's, then the global ones. In the 4.1 betas the subclass's guards ran before the base's, so a guard a subclass added ran even for callers the base's auth guard would refuse. For a handler the subclass declared itself, the base's filters were also tried first, so a catch-all on the base hid the subclass's own, more specific filter. Class cooldowns keep their order, and `inspectHandler` and the `MetadataKey.Guards` metadata list the stages in the order they now run.
