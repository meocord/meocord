---
'meocord': patch
---

`createMockGuild()`'s JSDoc now says what permissions the @everyone role it makes has in each mode. In default mode the role has no permissions. Under `useStrictMocks()` it has the ones Discord gives @everyone in a new server. Before, the JSDoc said "no permissions" for both modes. The mock itself is unchanged.
