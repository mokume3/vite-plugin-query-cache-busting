import { defineDiagnostics } from 'nostics'

export const diagnostics = defineDiagnostics({
  codes: {
    QCB_RELATIVE_BASE: {
      why: (p: { base: string }) =>
        `Relative base is not supported: base: ${JSON.stringify(p.base)}`,
      fix: "With a relative base, Vite switches to computing JS-side URLs at runtime, so the query can't be applied statically. Use an absolute path (e.g. base: '/').",
    },
    QCB_LIB_MODE: {
      why: 'Library mode (build.lib) is not supported: build.lib is set',
      fix: "Adding a query to import specifiers in the distributed output would break the consumer's bundler or Node's module resolution. Remove this plugin from plugins for library builds.",
    },
    QCB_CHUNK_IMPORT_MAP: {
      why: 'Cannot be combined with build.chunkImportMap: build.chunkImportMap is enabled',
      fix: 'Vite itself does not support combining build.chunkImportMap with experimental.renderBuiltUrl. Disable one of the two.',
    },
    QCB_VITE_TOO_OLD: {
      why: (p: { viteMajor: number }) => `Vite 8 or later is required (detected: ${p.viteMajor})`,
      fix: 'The assumptions behind experimental.renderBuiltUrl and parseAst do not hold below Vite 8. Upgrade to Vite 8 or later.',
    },
    QCB_VITE_UNVERIFIED: {
      why: (p: { viteMajor: number }) => `Vite ${p.viteMajor} is unverified`,
      fix: 'This plugin has only been verified against Vite 8. Check that no verify warnings appear after the build.',
    },
    QCB_RENDER_BUILT_URL_HIJACKED: {
      why: "experimental.renderBuiltUrl has been overridden by another plugin: the resolved config value is not this plugin's wrapper",
      fix: 'Only one renderBuiltUrl can be configured, so cache busting would otherwise be silently disabled. Remove the conflicting plugin or adjust plugin order.',
    },
    QCB_RENDER_BUILT_URL_OBJECT: {
      why: 'The existing renderBuiltUrl returned an object: { relative } / { runtime } return values are not supported',
      fix: 'That implies runtime computation, so the query cannot be applied statically. Make the existing renderBuiltUrl return a string instead.',
    },
    QCB_API_DRIFT: {
      why: 'renderBuiltUrl was never called during the build: assets, CSS, or HTML were emitted but the hook was never invoked',
      fix: "Vite's experimental.renderBuiltUrl API may have changed. Check the combination of this plugin's version and your Vite version.",
    },
    QCB_NON_ES_FORMAT: {
      why: (p: { format: string }) =>
        `Chunk-to-chunk imports cannot be rewritten for non-ES output: output.format: ${p.format}`,
      fix: 'Formats like SystemJS do not represent import specifiers as AST import nodes. Query busting for assets, CSS, and HTML still happens as usual.',
    },
    QCB_MANIFEST_MISSING: {
      why: (p: { manifestFileName: string }) =>
        `Could not rewrite the manifest: ${p.manifestFileName} was not found in the output`,
      fix: "Vite's manifest generation may be running after this plugin. The build was aborted because consumers of the manifest would otherwise load URLs without the query.",
    },
    QCB_HASHED_FILENAME_PATTERN: {
      why: (p: { paths: string[] }) =>
        `The output filename pattern contains [hash]: ${p.paths.join(', ')}`,
      fix: 'This would double up filename hashing and query busting, defeating the point of this plugin. Remove [hash] from the pattern.',
    },
    QCB_UNVERIFIABLE_FILENAME_PATTERN: {
      why: (p: { paths: string[] }) =>
        `The output filename pattern is a function, so it cannot be verified: ${p.paths.join(', ')}`,
      fix: 'It cannot be statically determined whether the function returns a name containing [hash]. Check after the build that output filenames are not hashed.',
    },
    QCB_MULTIPLE_OUTPUTS: {
      why: 'An array build.rollupOptions.output (multiple outputs) is not supported: output is specified as an array',
      fix: 'Only a single output is supported. Make output a single object.',
    },
    QCB_MISSING_QUERY: {
      why: (p: { count: number }) => `${p.count} reference(s) are missing the query`,
      fix: "This may be a path hardcoded as a string in the source. If intentional, suppress this with verify: 'off'.",
    },
  },
})
