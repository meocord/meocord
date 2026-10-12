---
'meocord': patch
---

In development, the warning that a customId param shares its name with a modal field or select menu choice is now given once for each handler that has the collision, and names it as `Controller.method`. Before, two controllers with a method of the same name and the same collision got one warning between them, naming only the method. Nothing else changes: the handler still receives the customId param. Rename one of the two to receive both.
