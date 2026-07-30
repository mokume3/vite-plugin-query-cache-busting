import { Ansis } from 'ansis'

import { LOG_PREFIX } from './constants'
import type { Issue } from './guards'
import type { Finding } from './verify'

export type IssueLevel = 'warn' | 'error'

export interface Palette {
  prefix: (text: string) => string
  label: (level: IssueLevel, text: string) => string
  path: (text: string) => string
  query: (text: string) => string
  bad: (text: string) => string
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
    bad: (text) => ansis.red.underline(text),
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

export function formatIssue(palette: Palette, level: IssueLevel, issue: Issue): string {
  const lines = [`${palette.prefix(LOG_PREFIX)} ${palette.label(level, level)}  ${issue.title}`]

  if (issue.details.length > 0) {
    lines.push('')
    for (const detail of issue.details) lines.push(`  ${detail}`)
  }

  if (issue.hints.length > 0) {
    lines.push('')
    for (const hint of issue.hints) lines.push(`  ${palette.hint(hint)}`)
  }

  return lines.join('\n')
}

export function formatFindings(palette: Palette, level: IssueLevel, findings: Finding[]): string {
  const lines = [
    `${palette.prefix(LOG_PREFIX)} ${palette.label(level, level)}  query が付いていない参照が ${palette.count(String(findings.length))} 件あります`,
    '',
  ]

  for (const finding of findings) {
    lines.push(
      `  ${palette.path(`${finding.file}:${finding.line}:${finding.column}`)}`,
      `    ${finding.snippet}`,
      `    ${' '.repeat(finding.caretOffset)}${palette.bad('^'.repeat(finding.reference.length))}`,
      '',
    )
  }

  lines.push(
    `  ${palette.hint('ソース中に文字列でハードコードされたパスの可能性があります。')}`,
    `  ${palette.hint("意図的な場合は verify: 'off' で抑制できます。")}`,
  )

  return lines.join('\n')
}
