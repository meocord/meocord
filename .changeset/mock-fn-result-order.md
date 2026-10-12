---
'meocord': patch
---

A mock function from `createMockFn`, which every MeoCord mock is without `useMockFn`, now records each call's entry in `mock.results` as the call starts and fills it in when the call ends, as jest and Vitest do. A call that calls the mock again inside it had its results recorded in the order the calls finished, so `results[0]` belonged to the innermost call and `toHaveNthReturnedWith` checked the wrong call. A call still running reads `{ type: 'incomplete', value: undefined }`, and `MockResult['type']` gains `'incomplete'`, as jest's and Vitest's have.
