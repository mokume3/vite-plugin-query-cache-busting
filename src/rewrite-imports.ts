import MagicString from 'magic-string'
import { parseAst } from 'vite'

import { appendQuery } from './url'

interface AstNode {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

interface StringLiteralNode extends AstNode {
  type: 'Literal'
  value: string
}

interface StaticTemplateLiteralNode extends AstNode {
  type: 'TemplateLiteral'
  expressions: unknown[]
  quasis: { value: { cooked: string | null } }[]
}

export interface RewriteResult {
  code: string
  map: ReturnType<MagicString['generateMap']>
  count: number
}

const SOURCE_BEARING_TYPES = new Set([
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
  'ImportExpression',
])

const SKIPPED_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'parent'])

/**
 * チャンク間の import 指定子に query を付与する。
 * 書き換え対象は import / export の source と import() の引数リテラルのみ。
 * 引数は文字列リテラルと、式展開のない TemplateLiteral（例: `./dep.js`）の両方を扱う。
 * esbuild の minify が import() の引数を後者の形に変換することがあるため。
 */
export function rewriteImports(
  code: string,
  query: string,
  fileName: string,
): RewriteResult | null {
  const ast = parseAst(code)
  const magicString = new MagicString(code)
  let count = 0

  walk(ast, (node) => {
    if (!SOURCE_BEARING_TYPES.has(node.type)) return

    const source = node.source
    if (!isStaticSpecifierNode(source)) return

    const value = getStaticSpecifierValue(source)
    if (value === null) return
    if (!isRewritableSpecifier(value)) return

    const rewritten = appendQuery(value, query)
    if (rewritten === value) return

    magicString.update(source.start, source.end, JSON.stringify(rewritten))
    count += 1
  })

  if (count === 0) return null

  return {
    code: magicString.toString(),
    map: magicString.generateMap({ hires: 'boundary', source: fileName }),
    count,
  }
}

/** AST を総なめして type を持つノードを訪問する */
function walk(node: unknown, visit: (node: AstNode) => void): void {
  if (node === null || typeof node !== 'object') return

  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }

  const record = node as Record<string, unknown>
  if (typeof record.type === 'string') visit(record as AstNode)

  for (const key of Object.keys(record)) {
    if (SKIPPED_KEYS.has(key)) continue
    walk(record[key], visit)
  }
}

function isStringLiteral(node: unknown): node is StringLiteralNode {
  if (node === null || typeof node !== 'object') return false

  const record = node as Record<string, unknown>
  return record.type === 'Literal' && typeof record.value === 'string'
}

/** 式展開のない TemplateLiteral か（minify 後の import() 引数はこの形になる） */
function isStaticTemplateLiteral(node: unknown): node is StaticTemplateLiteralNode {
  if (node === null || typeof node !== 'object') return false

  const record = node as Record<string, unknown>
  if (record.type !== 'TemplateLiteral') return false

  const expressions = record.expressions
  const quasis = record.quasis
  return Array.isArray(expressions) && expressions.length === 0 && Array.isArray(quasis)
}

/** import 指定子として静的に扱えるノードか（文字列リテラル or 式展開のない TemplateLiteral） */
function isStaticSpecifierNode(
  node: unknown,
): node is StringLiteralNode | StaticTemplateLiteralNode {
  return isStringLiteral(node) || isStaticTemplateLiteral(node)
}

/**
 * import 指定子ノードから静的な文字列値を取り出す。
 * 式展開のない TemplateLiteral は、esbuild の minify が import() の引数を
 * この形にすることがあるため文字列リテラルと同様に扱う。
 */
function getStaticSpecifierValue(node: StringLiteralNode | StaticTemplateLiteralNode): string | null {
  if (node.type === 'Literal') return node.value
  return node.quasis[0]?.value.cooked ?? null
}

/** チャンクへの参照とみなせる指定子か（ベア指定子と外部 URL を除く） */
function isRewritableSpecifier(specifier: string): boolean {
  if (specifier.startsWith('//')) return false

  return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')
}
