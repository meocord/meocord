---
'meocord': patch
---

`@Inject` on a method's parameter is refused with MeoCord's own message, naming the method: "`Shop.run`: @Inject goes on a constructor parameter or a property, not a method parameter." It threw inversify's raw "Unexpected injection error" before, which a built bot printed with its stack. Move the parameter to the constructor, or inject the value into a property.
