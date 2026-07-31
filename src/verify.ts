export interface OutputFile {
  fileName: string
  content: string
}

export interface Finding {
  file: string
  line: number
  column: number
  reference: string
  snippet: string
  caretOffset: number
}

const SCANNED_EXTENSIONS = ['.js', '.mjs', '.cjs', '.css', '.html']
const NAME_CHAR_RE = /[A-Za-z0-9_.-]/
const PATH_CHAR_RE = /[A-Za-z0-9_.:/-]/
const URL_DELIMITER_RE = /["'`(=]/
const SNIPPET_CONTEXT = 30

/** 中身を走査する対象のファイルか */
export function isScannableFile(fileName: string): boolean {
  return SCANNED_EXTENSIONS.some((extension) => fileName.endsWith(extension))
}

/** 参照名として追跡する対象のファイルか（sourcemap は URL として参照されないため除外） */
export function isTrackedName(fileName: string): boolean {
  return !fileName.endsWith('.map')
}

/**
 * 出力ファイルの中から、query が付いていない出力ファイル名への参照を探す。
 * 書き換えは行わず検出のみ。
 */
export function findMissingQuery(
  files: OutputFile[],
  referenceNames: string[],
  query: string,
): Finding[] {
  const findings: Finding[] = []
  const names = referenceNames.filter((name) => isTrackedName(name))

  for (const file of files) {
    if (!isScannableFile(file.fileName)) continue

    for (const name of names) {
      let index = file.content.indexOf(name)

      while (index !== -1) {
        if (
          isReferenceBoundary(file.content, index, name) &&
          !file.content.startsWith(`?${query}`, index + name.length)
        ) {
          findings.push(createFinding(file.fileName, file.content, index, name))
        }
        index = file.content.indexOf(name, index + 1)
      }
    }
  }

  return findings
}

/**
 * 前後がファイル名の一部でないこと（より長いファイル名の一部への一致を弾く）。
 * 4段の判定をすべて満たした場合のみ参照とみなす。
 * 1. 直前が名前構成文字でないこと（"xassets/a.js" のような、より長い識別子の末尾への
 *    偶然の一致を弾く）
 * 2. 直後が名前構成文字でないこと（a.js.map のような、より長いファイル名の一部への
 *    一致を弾く）
 * 3. 一致位置から後ろ向きにパス構成文字（コロン・スラッシュを含む。CDN の絶対 URL
 *    "https://..." を辿りきれるようにするため）を辿る
 * 4. 辿り終えた手前の文字が URL を開く区切り文字（" ' ` ( =）であること。
 *    空白は区切り文字に含めない（コメント内のパスを弾くため）。ファイル先頭に
 *    達した場合は区切り文字が無いので参照とみなさない。
 */
function isReferenceBoundary(content: string, index: number, name: string): boolean {
  if (index > 0 && NAME_CHAR_RE.test(content[index - 1] ?? '')) return false

  const afterIndex = index + name.length
  if (afterIndex < content.length && NAME_CHAR_RE.test(content[afterIndex] ?? '')) return false

  let start = index
  while (start > 0 && PATH_CHAR_RE.test(content[start - 1] ?? '')) start -= 1

  if (start === 0) return false

  return URL_DELIMITER_RE.test(content[start - 1] ?? '')
}

function createFinding(
  fileName: string,
  content: string,
  index: number,
  reference: string,
): Finding {
  const before = content.slice(0, index)
  const line = before.split('\n').length
  const lineStart = before.lastIndexOf('\n') + 1
  const column = index - lineStart + 1

  const rawLineEnd = content.indexOf('\n', index)
  const lineEnd = rawLineEnd === -1 ? content.length : rawLineEnd

  const contextStart = Math.max(lineStart, index - SNIPPET_CONTEXT)
  const contextEnd = Math.min(lineEnd, index + reference.length + SNIPPET_CONTEXT)

  const prefix = contextStart > lineStart ? '...' : ''
  const suffix = contextEnd < lineEnd ? '...' : ''

  return {
    file: fileName,
    line,
    column,
    reference,
    snippet: `${prefix}${content.slice(contextStart, contextEnd)}${suffix}`,
    caretOffset: prefix.length + (index - contextStart),
  }
}
