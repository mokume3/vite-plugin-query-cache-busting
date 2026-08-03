import { hasQueryParam } from './url'

export interface OutputFile {
  fileName: string
  content: string
}

export interface Finding {
  file: string
  line: number
  column: number
  reference: string
}

const SCANNED_EXTENSIONS = ['.js', '.mjs', '.cjs', '.css', '.html']
const NAME_CHAR_RE = /[A-Za-z0-9_.-]/
const PATH_CHAR_RE = /[A-Za-z0-9_.:/-]/
const URL_DELIMITER_RE = /["'`(=]/

/** Whether this file's content should be scanned */
export function isScannableFile(fileName: string): boolean {
  return SCANNED_EXTENSIONS.some((extension) => fileName.endsWith(extension))
}

/** Whether this file should be tracked as a reference name (sourcemaps are excluded since they're never referenced as a URL) */
export function isTrackedName(fileName: string): boolean {
  return !fileName.endsWith('.map')
}

/**
 * Finds references to output filenames that are missing the query, across all output files.
 * Detection only — no rewriting happens here.
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
          !hasQueryParam(file.content, index + name.length, query)
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
 * Checks that neither side of the match is part of a longer filename (rejects an
 * incidental match against part of a longer filename). A match only counts as a
 * reference if all four checks pass.
 * 1. The character right before is not a name character (rejects an incidental match
 *    against the tail of a longer identifier, like "xassets/a.js")
 * 2. The character right after is not a name character (rejects a match against part
 *    of a longer filename, like a.js.map)
 * 3. Walk backward from the match through path characters (including colon and slash,
 *    so an absolute CDN URL like "https://..." can be walked all the way through)
 * 4. The character just before where that walk stopped must be a URL-opening delimiter
 *    (" ' ` ( =). Whitespace is not a delimiter (to reject paths inside comments). If the
 *    walk reaches the start of the file, there's no delimiter, so it doesn't count as a reference.
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

  return { file: fileName, line, column, reference }
}
