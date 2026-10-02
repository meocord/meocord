---
'meocord': patch
---

A service or other class whose constructor injects but which has no decorator, such as a missing `@Service()`, is refused as the app is created, naming the class and the decorator to add, rather than with inversify's `Found unexpected missing metadata on type …` error. Without a decorator TypeScript records none of the constructor's types, so the class could never be created; a constructor parameter with a default value or a rest parameter, and a subclass that keeps its decorated base's constructor, are created as before.
