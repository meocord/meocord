/**
 * How specific a route pattern is, for ranking the patterns that can match one input: more literal
 * text first, then a fixed length before one taking the rest, then no optional param before one, then
 * fewer params, then more typed params, whose segments take fewer values. Component patterns count literal
 * characters; message patterns count literal words.
 */
export function routeSpecificity({
  literals,
  params,
  rest = false,
  optional = false,
  typed = 0,
}: {
  literals: number
  params: number
  rest?: boolean
  optional?: boolean
  typed?: number
}): number {
  return literals * 1_000 - (rest ? 500 : 0) - (optional ? 250 : 0) - params + typed / 100
}
