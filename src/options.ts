import { LOG_PREFIX } from './constants'
import type { VersionOption } from './version'

export type VerifyMode = 'warn' | 'error' | 'off'

export interface Options {
  /**
   * query に載せる値。
   * 関数が undefined か空文字を返した場合はデフォルト（ローカル時刻の YYYYMMDDHHmm）にフォールバックする。
   * @default ローカル時刻の YYYYMMDDHHmm（例: "202607302209"）
   */
  version?: VersionOption

  /**
   * query のキー。false を指定するとキー無しの裸クエリ（"?202607302209"）になる。
   * @default 'v'
   */
  key?: string | false

  /**
   * 出力に query 未付与の参照が残っていないかの自己検証。
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
    throw new Error(`${LOG_PREFIX} option "version" must not be an empty string`)
  }

  if (key !== false) {
    if (typeof key !== 'string' || key === '') {
      throw new Error(`${LOG_PREFIX} option "key" must be a non-empty string or false`)
    }
    if (INVALID_KEY_CHAR_RE.test(key)) {
      throw new Error(
        `${LOG_PREFIX} option "key" must not contain "=", "?", "&", "#" or whitespace, got ${JSON.stringify(key)}`,
      )
    }
  }

  if (!VERIFY_MODES.has(verify)) {
    throw new Error(
      `${LOG_PREFIX} option "verify" must be one of "warn", "error", "off", got ${JSON.stringify(verify)}`,
    )
  }

  return { version, key, verify }
}
