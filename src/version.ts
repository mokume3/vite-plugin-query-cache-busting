export type VersionOption = string | (() => string | undefined | Promise<string | undefined>)

const pad = (value: number): string => String(value).padStart(2, '0')

/** Date をローカル時刻の YYYYMMDDHHmm にする */
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
 * version オプションを解決する。
 * 関数が undefined か空文字を返した場合はタイムスタンプにフォールバックする。
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
