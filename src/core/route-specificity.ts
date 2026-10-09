/**
 * How specific a route pattern is, for ranking the message patterns that can match one message: more literal
 * words first, then a fixed length before one taking the rest, then no optional param before one, then
 * fewer params, then narrower typed params, whose words take fewer values. Component patterns count literal
 * characters, for CommandMeta.specificity alone.
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
  /** How narrow the typed params are together; below one param's weight, so it only breaks ties. */
  typed?: number
}): number {
  return literals * 1_000 - (rest ? 500 : 0) - (optional ? 250 : 0) - params + typed / 1_000
}
