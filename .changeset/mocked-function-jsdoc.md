---
'meocord': patch
---

`MockedFunction`'s and `MockInstance`'s documentation says what their types check: calling a mock is checked against the function it mocks, and the values its mock API takes and records, such as `mockResolvedValue`'s and each of `mock.calls`' arguments, are not, for any function. A partial fake such as `guild.members.fetch.mockResolvedValue({ id })` type-checks. Types are unchanged.
