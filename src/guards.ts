import type { Diagnostic } from 'nostics'

import { diagnostics } from './diagnostics'

export interface ConfigSnapshot {
  base: string
  isLib: boolean
  chunkImportMap: boolean
  viteMajor: number
}

/** バージョン文字列からメジャーバージョンを取り出す。解釈できなければ 0 */
export function parseMajor(version: string): number {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10)
  return Number.isNaN(major) ? 0 : major
}

function relativeBaseIssue(base: string): Diagnostic | undefined {
  if (base !== '' && !base.startsWith('.')) return undefined
  return diagnostics.QCB_RELATIVE_BASE({ base })
}

function libModeIssue(isLib: boolean): Diagnostic | undefined {
  if (!isLib) return undefined
  return diagnostics.QCB_LIB_MODE()
}

function chunkImportMapIssue(chunkImportMap: boolean): Diagnostic | undefined {
  if (!chunkImportMap) return undefined
  return diagnostics.QCB_CHUNK_IMPORT_MAP()
}

function unsupportedViteMajorIssue(viteMajor: number): Diagnostic | undefined {
  if (viteMajor >= 8) return undefined
  return diagnostics.QCB_VITE_TOO_OLD({ viteMajor })
}

function unverifiedViteMajorIssue(viteMajor: number): Diagnostic | undefined {
  if (viteMajor <= 8) return undefined
  return diagnostics.QCB_VITE_UNVERIFIED({ viteMajor })
}

export function collectConfigIssues(snapshot: ConfigSnapshot): {
  errors: Diagnostic[]
  warnings: Diagnostic[]
} {
  const errors = [
    relativeBaseIssue(snapshot.base),
    libModeIssue(snapshot.isLib),
    chunkImportMapIssue(snapshot.chunkImportMap),
    unsupportedViteMajorIssue(snapshot.viteMajor),
  ].filter((issue): issue is Diagnostic => issue !== undefined)

  const warnings = [unverifiedViteMajorIssue(snapshot.viteMajor)].filter(
    (issue): issue is Diagnostic => issue !== undefined,
  )

  return { errors, warnings }
}

export function hijackedRenderBuiltUrlIssue(): Diagnostic {
  return diagnostics.QCB_RENDER_BUILT_URL_HIJACKED()
}

export function userHookReturnedObjectIssue(): Diagnostic {
  return diagnostics.QCB_RENDER_BUILT_URL_OBJECT()
}

export function apiDriftIssue(): Diagnostic {
  return diagnostics.QCB_API_DRIFT()
}

export function nonEsFormatIssue(format: string): Diagnostic {
  return diagnostics.QCB_NON_ES_FORMAT({ format })
}

export function manifestMissingIssue(manifestFileName: string): Diagnostic {
  return diagnostics.QCB_MANIFEST_MISSING({ manifestFileName })
}

export function hashedFileNamePatternIssue(paths: string[]): Diagnostic {
  return diagnostics.QCB_HASHED_FILENAME_PATTERN({ paths })
}

export function unverifiableFileNamePatternIssue(paths: string[]): Diagnostic {
  return diagnostics.QCB_UNVERIFIABLE_FILENAME_PATTERN({ paths })
}

export function multipleOutputsIssue(): Diagnostic {
  return diagnostics.QCB_MULTIPLE_OUTPUTS()
}
