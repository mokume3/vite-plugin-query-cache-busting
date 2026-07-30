export interface Issue {
  title: string
  details: string[]
  hints: string[]
}

export interface ConfigSnapshot {
  base: string
  isLib: boolean
  chunkImportMap: boolean
  viteMajor: number
}

/** バージョン文字列からメジャーバージョンを取り出す。解釈できなければ 0 */
export function parseMajor(version: string): number {
  const major = Math.trunc(Number(version.split('.')[0] ?? ''))
  return Number.isNaN(major) ? 0 : major
}

function relativeBaseIssue(base: string): Issue | undefined {
  if (base !== '' && !base.startsWith('.')) return undefined

  return {
    title: '相対 base には対応していません',
    details: [`base: ${JSON.stringify(base)}`],
    hints: [
      '相対 base では Vite が JS 内の URL を実行時計算に切り替えるため、',
      "query を静的に付与できません。絶対パス（例: base: '/'）を指定してください。",
    ],
  }
}

function libModeIssue(isLib: boolean): Issue | undefined {
  if (!isLib) return undefined

  return {
    title: 'ライブラリモード（build.lib）には対応していません',
    details: ['build.lib が設定されています'],
    hints: [
      '配布物の import 指定子に query が付くと、利用側のバンドラや Node の',
      'モジュール解決が壊れるためです。',
    ],
  }
}

function chunkImportMapIssue(chunkImportMap: boolean): Issue | undefined {
  if (!chunkImportMap) return undefined

  return {
    title: 'build.chunkImportMap と併用できません',
    details: ['build.chunkImportMap が有効になっています'],
    hints: [
      'Vite 自身が build.chunkImportMap と experimental.renderBuiltUrl の',
      '併用を非対応としています。どちらか一方を無効にしてください。',
    ],
  }
}

function unsupportedViteMajorIssue(viteMajor: number): Issue | undefined {
  if (viteMajor >= 8) return undefined

  return {
    title: `Vite 8 以上が必要です（検出: ${viteMajor}）`,
    details: [],
    hints: ['experimental.renderBuiltUrl と parseAst の前提が Vite 8 未満では揃いません。'],
  }
}

function unverifiedViteMajorIssue(viteMajor: number): Issue | undefined {
  if (viteMajor <= 8) return undefined

  return {
    title: `Vite ${viteMajor} は未検証です`,
    details: [],
    hints: [
      'このプラグインは Vite 8 でのみ検証されています。',
      'ビルド後に verify の警告が出ていないか確認してください。',
    ],
  }
}

export function collectConfigIssues(snapshot: ConfigSnapshot): {
  errors: Issue[]
  warnings: Issue[]
} {
  const errors = [
    relativeBaseIssue(snapshot.base),
    libModeIssue(snapshot.isLib),
    chunkImportMapIssue(snapshot.chunkImportMap),
    unsupportedViteMajorIssue(snapshot.viteMajor),
  ].filter((issue): issue is Issue => issue !== undefined)

  const warnings = [unverifiedViteMajorIssue(snapshot.viteMajor)].filter(
    (issue): issue is Issue => issue !== undefined,
  )

  return { errors, warnings }
}

export function hijackedRenderBuiltUrlIssue(): Issue {
  return {
    title: 'experimental.renderBuiltUrl が別のプラグインに上書きされています',
    details: ['解決後の設定値がこのプラグインのラッパーではありません'],
    hints: [
      'renderBuiltUrl は1つしか設定できないため、このままではキャッシュバスティングが',
      '無言で無効になります。競合するプラグインを外すか、順序を調整してください。',
    ],
  }
}

export function userHookReturnedObjectIssue(): Issue {
  return {
    title: '既存の renderBuiltUrl がオブジェクトを返しました',
    details: ['{ relative } / { runtime } の戻り値には対応していません'],
    hints: [
      '実行時計算になるため query を静的に付与できません。',
      '既存の renderBuiltUrl が文字列を返すようにしてください。',
    ],
  }
}

export function apiDriftIssue(): Issue {
  return {
    title: 'renderBuiltUrl がビルド中に一度も呼ばれませんでした',
    details: ['アセット・CSS・HTML が出力されているのにフックが呼ばれていません'],
    hints: [
      'Vite 側の experimental.renderBuiltUrl の仕様が変わった可能性があります。',
      'このプラグインのバージョンと Vite のバージョンの組み合わせを確認してください。',
    ],
  }
}

export function nonEsFormatIssue(format: string): Issue {
  return {
    title: 'ES 形式以外の出力ではチャンク間 import を書き換えられません',
    details: [`output.format: ${format}`],
    hints: [
      'SystemJS などの形式では import 指定子が AST の import ノードとして現れないためです。',
      'アセット・CSS・HTML への query 付与は引き続き行われます。',
    ],
  }
}

export function manifestMissingIssue(manifestFileName: string): Issue {
  return {
    title: 'manifest を書き換えられませんでした',
    details: [`出力に ${manifestFileName} が見つかりません`],
    hints: [
      'Vite の manifest 生成がこのプラグインより後で行われた可能性があります。',
      'このままではバックエンド統合時に query が付かないため、ビルドを中断しました。',
    ],
  }
}

export function hashedFileNamePatternIssue(keys: string[]): Issue {
  return {
    title: '出力ファイル名パターンに [hash] が含まれています',
    details: keys.map((key) => `build.rollupOptions.output.${key}`),
    hints: [
      'ファイル名ハッシュと query の二重掛けになり、このプラグインを使う意味が',
      'なくなります。パターンから [hash] を外してください。',
    ],
  }
}

export function unverifiableFileNamePatternIssue(keys: string[]): Issue {
  return {
    title: '出力ファイル名パターンが関数で指定されているため検証できません',
    details: keys.map((key) => `build.rollupOptions.output.${key}`),
    hints: [
      '関数が [hash] を含む名前を返さないか、静的に判定できません。',
      'ビルド後に出力ファイル名にハッシュが付いていないか確認してください。',
    ],
  }
}

export function multipleOutputsIssue(): Issue {
  return {
    title: 'build.rollupOptions.output が配列（複数出力）の構成には対応していません',
    details: ['output が配列で指定されています'],
    hints: ['v1 では単一出力のみ対応しています。output を単一のオブジェクトにしてください。'],
  }
}
