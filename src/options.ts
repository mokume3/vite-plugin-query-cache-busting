import { LOG_PREFIX } from './constants'
import type { VersionOption } from './version'

export type VerifyMode = 'warn' | 'error' | 'off'

export interface Options {
  /**
   * The value placed in the query.
   * Falls back to the default (local time as YYYYMMDDHHmm) if the function returns undefined or an empty string.
   * @default Local time as YYYYMMDDHHmm (e.g. "202607302209")
   */
  version?: VersionOption

  /**
   * The query key. `false` produces a bare query with no key ("?202607302209").
   * @default 'v'
   */
  key?: string | false

  /**
   * Self-check for references in the output that are missing the query.
   * @default 'warn'
   */
  verify?: VerifyMode
}

export interface ResolvedOptions {
  version: VersionOption | undefined
  key: string | false
  verify: VerifyMode
}

const VERIFY_MODES = new Set<VerifyMode>(['warn', 'error', 'off'])
const INVALID_KEY_CHAR_RE = /[=?&#\s]/

export function normalizeOptions(options: Options = {}): ResolvedOptions {
  const { version, key = 'v', verify = 'warn' } = options

  if (version === '') {
    throw new Error(`${LOG_PREFIX} option "version" cannot be an empty string`)
  }

  if (key !== false) {
    if (typeof key !== 'string' || key === '') {
      throw new Error(`${LOG_PREFIX} option "key" must be a non-empty string or false`)
    }
    if (INVALID_KEY_CHAR_RE.test(key)) {
      throw new Error(
        `${LOG_PREFIX} option "key" cannot contain "=" "?" "&" "#" or whitespace: ${JSON.stringify(key)}`,
      )
    }
  }

  if (!VERIFY_MODES.has(verify)) {
    throw new Error(
      `${LOG_PREFIX} option "verify" must be one of "warn" / "error" / "off": ${JSON.stringify(verify)}`,
    )
  }

  return { version, key, verify }
}
