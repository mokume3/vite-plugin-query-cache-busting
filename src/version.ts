export type VersionOption = string | (() => string | undefined | Promise<string | undefined>)

const pad = (value: number): string => String(value).padStart(2, '0')

/** Formats a Date as local time YYYYMMDDHHmm */
export function formatTimestamp(date: Date): string {
  return [
    String(date.getFullYear()),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('')
}

/**
 * Resolves the version option.
 * Falls back to a timestamp if the function returns undefined or an empty string.
 */
export async function resolveVersion(
  version: VersionOption | undefined,
  now: Date = new Date(),
): Promise<string> {
  if (typeof version === 'string') return version

  if (typeof version === 'function') {
    const resolved = await version()
    if (resolved !== undefined && resolved !== '') return resolved
  }

  return formatTimestamp(now)
}
