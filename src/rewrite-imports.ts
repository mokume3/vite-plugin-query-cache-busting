import { MagicString } from 'magic-string'
import { parseSync } from 'oxc-parser'

import { isRecord } from './guards'
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
 * Appends a query to chunk-to-chunk import specifiers.
 * Rewrite targets are only the source of import/export and import()'s argument literal.
 * The argument may be either a string literal or a no-substitution TemplateLiteral (e.g. `./dep.js`),
 * since esbuild's minify sometimes turns import()'s argument into the latter.
 */
export function rewriteImports(
  code: string,
  query: string,
  fileName: string,
): RewriteResult | null {
  const { program: ast } = parseSync(fileName, code)
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

/** Walks the entire AST, visiting every node that has a type and a position */
function walk(node: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }

  if (!isRecord(node)) return
  if (isAstNode(node)) visit(node)

  for (const key of Object.keys(node)) {
    if (SKIPPED_KEYS.has(key)) continue
    walk(node[key], visit)
  }
}

function isAstNode(node: unknown): node is AstNode {
  return (
    isRecord(node) &&
    typeof node.type === 'string' &&
    typeof node.start === 'number' &&
    typeof node.end === 'number'
  )
}

function isStringLiteral(node: unknown): node is StringLiteralNode {
  return isAstNode(node) && node.type === 'Literal' && typeof node.value === 'string'
}

/** Whether this is a no-substitution TemplateLiteral (import()'s argument takes this form after minify) */
function isStaticTemplateLiteral(node: unknown): node is StaticTemplateLiteralNode {
  if (!isAstNode(node) || node.type !== 'TemplateLiteral') return false

  const expressions = node.expressions
  const quasis = node.quasis
  return Array.isArray(expressions) && expressions.length === 0 && Array.isArray(quasis)
}

/** Whether this node can be treated as a static import specifier (string literal or no-substitution TemplateLiteral) */
function isStaticSpecifierNode(
  node: unknown,
): node is StringLiteralNode | StaticTemplateLiteralNode {
  return isStringLiteral(node) || isStaticTemplateLiteral(node)
}

/**
 * Extracts the static string value from an import specifier node.
 * A no-substitution TemplateLiteral is treated the same as a string literal, since
 * esbuild's minify sometimes turns import()'s argument into this form.
 */
function getStaticSpecifierValue(
  node: StringLiteralNode | StaticTemplateLiteralNode,
): string | null {
  if (node.type === 'Literal') return node.value
  return node.quasis[0]?.value.cooked ?? null
}

/** Whether this specifier can be treated as a reference to a chunk (excludes bare specifiers and external URLs) */
function isRewritableSpecifier(specifier: string): boolean {
  if (specifier.startsWith('//')) return false

  return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')
}
