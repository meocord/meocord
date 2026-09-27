/** A call the smoke app reported through `report('actor', …)`: who made it, what it was and how it ended. */
export interface ActorMarker {
  event: string
  user?: unknown
  what?: unknown
  outcome?: unknown
}

/**
 * The line saying who made a call of the manual checklist: the expected clicker, someone else, or, with no clicker
 * set, the user's id. Commands registered globally reach anyone with the application, so a call is not assumed to
 * be yours. `undefined` for any other marker.
 */
export function actorLine(marker: ActorMarker, clickerId: string): string | undefined {
  if (marker.event !== 'actor') return undefined
  const call = `${String(marker.what)} (${String(marker.outcome)})`
  if (!clickerId) return `   ${call} by user ${String(marker.user)}`
  if (marker.user === clickerId) return `   ${call} by the expected clicker`
  return `   ${call} by ANOTHER user, ${String(marker.user)}, not MEOCORD_E2E_CLICKER_ID`
}
