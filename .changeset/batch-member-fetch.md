---
'meocord': patch
---

A mock guild's `members.fetch({ user: ids })` now resolves to a collection of each of those members, found in the cache or made the way `members.fetch(id)` makes one. It resolved to an empty collection, so in a test a message command naming two or more members by ID that the guild hasn't cached refused them all as not members of the server, while one such member resolved. Mentioned members were not affected: they come from the message's mentions.
