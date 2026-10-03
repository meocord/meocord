---
'meocord': patch
---

A mock guild's `members.fetch({ user: ids })` now resolves to a collection of each of those members, found in the cache or made the way `members.fetch(id)` makes one. It resolved to an empty collection, so a message command whose params name two or more members the guild hasn't cached refused them all as not members of the server in a test, while one such member resolved.
