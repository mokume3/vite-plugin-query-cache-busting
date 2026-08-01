import { Ansis } from 'ansis'
import type { Diagnostic } from 'nostics'

import { LOG_PREFIX } from './constants'

export type IssueLevel = 'warn' | 'error'

export interface Palette {
  prefix: (text: string) => string
  label: (level: IssueLevel, text: string) => string
  path: (text: string) => string
  query: (text: string) => string
  count: (text: string) => string
  hint: (text: string) => string
}

/**
 * 配色を作る。
 * テストでは new Ansis(0) を渡して色を無効化し、メッセージの中身を検証する。
 */
export function createPalette(ansis: Ansis = new Ansis()): Palette {
  return {
    prefix: (text) => ansis.cyan.dim(text),
    label: (level, text) => (level === 'error' ? ansis.red.bold(text) : ansis.yellow.bold(text)),
    path: (text) => ansis.cyan(text),
    query: (text) => ansis.green(text),
    count: (text) => ansis.bold(text),
    hint: (text) => ansis.dim(text),
  }
}

export function formatSummary(
  palette: Palette,
  query: string,
  counts: Record<string, number>,
): string {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const breakdown = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([extension, count]) => `${extension} ${count}`)
    .join(', ')

  const head = `${palette.prefix(LOG_PREFIX)} ${palette.query(`?${query}`)} を ${palette.count(String(total))} 件の参照に付与`

  return breakdown === '' ? head : `${head} (${breakdown})`
}

/**
 * 診断を [CODE] level  message の見出し + fix/sources のツリー表示に整形する。
 * nostics の formatDiagnostic/ansiFormatter と同じレイアウト（├▶/╰▶ 接続）を踏襲するが、
 * severity（error/warn）の文字表記と色分けを自前で加えている。
 */
export function formatDiagnostic(
  palette: Palette,
  level: IssueLevel,
  diagnostic: Diagnostic,
): string {
  const header = `${palette.path(`[${diagnostic.name}]`)} ${palette.label(level, level)}  ${diagnostic.message}`

  const details: string[] = []
  if (diagnostic.fix !== undefined) details.push(`${palette.hint('fix:')} ${diagnostic.fix}`)
  if (diagnostic.sources !== undefined) {
    for (const source of diagnostic.sources) details.push(`${palette.hint('sources:')} ${source}`)
  }

  if (details.length === 0) return header

  return [
    header,
    ...details.map(
      (detail, index) => `${palette.hint(index < details.length - 1 ? '├▶' : '╰▶')} ${detail}`,
    ),
  ].join('\n')
}
