/**
 * Decode one App Router path segment before validating an AppSea identifier.
 *
 * Next can preserve percent-encoding for persistence-safe identifiers such as
 * `workspace:<hash>`. Decode exactly once at the server boundary; malformed
 * input is returned unchanged so the caller's schema rejects it.
 */
export function decodePathParam(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
