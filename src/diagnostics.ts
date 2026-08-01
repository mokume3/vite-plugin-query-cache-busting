import { defineDiagnostics } from 'nostics'

export const diagnostics = defineDiagnostics({
  codes: {
    QCB_RELATIVE_BASE: {
      why: (p: { base: string }) =>
        `相対 base には対応していません: base: ${JSON.stringify(p.base)}`,
      fix: "相対 base では Vite が JS 内の URL を実行時計算に切り替えるため、query を静的に付与できません。絶対パス（例: base: '/'）を指定してください。",
    },
    QCB_LIB_MODE: {
      why: 'ライブラリモード（build.lib）には対応していません: build.lib が設定されています',
      fix: '配布物の import 指定子に query が付くと、利用側のバンドラや Node のモジュール解決が壊れるためです。ライブラリのビルドでは plugins からこのプラグインを外してください。',
    },
    QCB_CHUNK_IMPORT_MAP: {
      why: 'build.chunkImportMap と併用できません: build.chunkImportMap が有効になっています',
      fix: 'Vite 自身が build.chunkImportMap と experimental.renderBuiltUrl の併用を非対応としています。どちらか一方を無効にしてください。',
    },
    QCB_VITE_TOO_OLD: {
      why: (p: { viteMajor: number }) => `Vite 8 以上が必要です（検出: ${p.viteMajor}）`,
      fix: 'experimental.renderBuiltUrl と parseAst の前提が Vite 8 未満では揃いません。Vite 8 以上にアップグレードしてください。',
    },
    QCB_VITE_UNVERIFIED: {
      why: (p: { viteMajor: number }) => `Vite ${p.viteMajor} は未検証です`,
      fix: 'このプラグインは Vite 8 でのみ検証されています。ビルド後に verify の警告が出ていないか確認してください。',
    },
    QCB_RENDER_BUILT_URL_HIJACKED: {
      why: 'experimental.renderBuiltUrl が別のプラグインに上書きされています: 解決後の設定値がこのプラグインのラッパーではありません',
      fix: 'renderBuiltUrl は1つしか設定できないため、このままではキャッシュバスティングが無言で無効になります。競合するプラグインを外すか、順序を調整してください。',
    },
    QCB_RENDER_BUILT_URL_OBJECT: {
      why: '既存の renderBuiltUrl がオブジェクトを返しました: { relative } / { runtime } の戻り値には対応していません',
      fix: '実行時計算になるため query を静的に付与できません。既存の renderBuiltUrl が文字列を返すようにしてください。',
    },
    QCB_API_DRIFT: {
      why: 'renderBuiltUrl がビルド中に一度も呼ばれませんでした: アセット・CSS・HTML が出力されているのにフックが呼ばれていません',
      fix: 'Vite 側の experimental.renderBuiltUrl の仕様が変わった可能性があります。このプラグインのバージョンと Vite のバージョンの組み合わせを確認してください。',
    },
    QCB_NON_ES_FORMAT: {
      why: (p: { format: string }) =>
        `ES 形式以外の出力ではチャンク間 import を書き換えられません: output.format: ${p.format}`,
      fix: 'SystemJS などの形式では import 指定子が AST の import ノードとして現れないためです。アセット・CSS・HTML への query 付与は引き続き行われます。',
    },
    QCB_MANIFEST_MISSING: {
      why: (p: { manifestFileName: string }) =>
        `manifest を書き換えられませんでした: 出力に ${p.manifestFileName} が見つかりません`,
      fix: 'Vite の manifest 生成がこのプラグインより後で行われた可能性があります。このままではバックエンド統合時に query が付かないため、ビルドを中断しました。',
    },
    QCB_HASHED_FILENAME_PATTERN: {
      why: (p: { paths: string[] }) =>
        `出力ファイル名パターンに [hash] が含まれています: ${p.paths.join('、')}`,
      fix: 'ファイル名ハッシュと query の二重掛けになり、このプラグインを使う意味がなくなります。パターンから [hash] を外してください。',
    },
    QCB_UNVERIFIABLE_FILENAME_PATTERN: {
      why: (p: { paths: string[] }) =>
        `出力ファイル名パターンが関数で指定されているため検証できません: ${p.paths.join('、')}`,
      fix: '関数が [hash] を含む名前を返さないか、静的に判定できません。ビルド後に出力ファイル名にハッシュが付いていないか確認してください。',
    },
    QCB_MULTIPLE_OUTPUTS: {
      why: 'build.rollupOptions.output が配列（複数出力）の構成には対応していません: output が配列で指定されています',
      fix: 'v1 では単一出力のみ対応しています。output を単一のオブジェクトにしてください。',
    },
    QCB_MISSING_QUERY: {
      why: (p: { count: number }) => `query 未付与の参照が ${p.count} 件あります`,
      fix: "ソース中に文字列でハードコードされたパスの可能性があります。意図的な場合は verify: 'off' で抑制できます。",
    },
  },
})
