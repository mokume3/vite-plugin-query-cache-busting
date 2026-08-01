# vite-plugin-query-cache-busting

English | [日本語](./README.ja.md)

A Vite plugin that busts caches with a **query parameter**
(`assets/index.js?v=202607302209`) instead of a filename hash
(`assets/index-a1b2c3d4.js`).

Intended for environments that must serve fixed filenames (a server, a CDN,
or an existing template referencing paths) and for deployments that
overwrite the same paths on every release.

## Requirements

- Vite 8

## Install

```bash
npm install -D vite-plugin-query-cache-busting
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import queryCacheBusting from 'vite-plugin-query-cache-busting'

export default defineConfig({
  base: '/',
  plugins: [queryCacheBusting()],
})
```

Output looks like this. Filenames lose their hash and gain a query instead.

```html
<script type="module" src="/assets/index.js?v=202607302209"></script>
<link rel="stylesheet" href="/assets/index.css?v=202607302209" />
```

The plugin sets `entryFileNames` / `chunkFileNames` / `assetFileNames` to hash-free patterns (`build.assetsDir` is respected). If you set these explicitly in `vite.config.ts`, your patterns take precedence — but the build fails if any pattern still contains `[hash]`, since that would double up filename hashing and querystring busting, defeating the point of this plugin.

## Options

| Option    | Type                                                                    | Default                      | Description                                                                                                   |
| --------- | ----------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `version` | `string \| (() => string \| undefined \| Promise<string \| undefined>)` | Local time as `YYYYMMDDHHmm` | The value placed in the query. Falls back to the default if a function returns `undefined` or an empty string |
| `key`     | `string \| false`                                                       | `'v'`                        | The query key. `false` produces a bare query (`?202607302209`) with no key                                    |
| `verify`  | `'warn' \| 'error' \| 'off'`                                            | `'warn'`                     | Self-check for references in the output that are missing the query                                            |

```ts
queryCacheBusting({
  version: () => process.env.GIT_SHA,
  key: 'v',
  verify: 'error',
})
```

`version` is resolved **once, at the start of the build**, and the same value is applied to every file in that build. It is not a per-file content hash, so every file's cache is invalidated on each deploy.

## What gets a query

- Hash removal from output filenames (`entryFileNames` / `chunkFileNames` / `assetFileNames`)
- HTML `<script src>` / `<link rel="stylesheet">` / `<link rel="modulepreload">`
- CSS `url()`
- Asset URLs in JS (`import img from './x.png'`, `new URL('./x.png', import.meta.url)`)
- The `__vitePreload` dependency array
- Chunk-to-chunk import specifiers
- `file` / `css` / `assets` in `.vite/manifest.json`
- Each value in `.vite/ssr-manifest.json` (when `build.ssrManifest` is enabled)

The plugin does nothing for SSR builds (`vite build --ssr`) — output filenames and references are left untouched, since adding a query to a server bundle would break Node's module resolution.

## Error output

Unsupported configurations and post-build verification are reported in the same "diagnostic code + tree" style as [nostics](https://nostics.dev).

```
[QCB_RELATIVE_BASE] error  Relative base is not supported: base: "./"
╰▶ fix: With a relative base, Vite switches to computing JS-side URLs at runtime, so the query can't be applied statically. Use an absolute path (e.g. base: '/').
```

Verify warnings/errors collect every un-busted reference's location into `sources`.

```
[QCB_MISSING_QUERY] warn  2 reference(s) are missing the query
├▶ fix: This may be a path hardcoded as a string in the source. If intentional, suppress this with verify: 'off'.
├▶ sources: assets/index.js:1:2043
╰▶ sources: assets/index.css:1:88
```

## Unsupported configurations

The following fail at build time:

- A relative `base` (`base: ''` / `'./'`) — Vite switches to computing JS-side URLs at runtime
- Library mode (`build.lib`) — it would break the consumer's module resolution
- `build.chunkImportMap` — Vite itself does not support combining this with `experimental.renderBuiltUrl`
- `experimental.renderBuiltUrl` being overridden by another plugin
- An explicitly configured output filename pattern that still contains `[hash]`
- `build.rollupOptions.output` being an array (multiple outputs)

## Known limitations

- `public/` files only get a query where Vite can trace the reference (processed HTML, or an `import`). A path hardcoded as a string in source code does not get one
- A `base` containing percent-encoding is not supported
- `@vitejs/plugin-legacy`'s SystemJS output can't have its chunk-to-chunk imports rewritten (a warning is emitted)
- When the output filename pattern is a function, the plugin cannot statically verify whether it produces a `[hash]`-containing name (a warning is emitted)
- With `build.sourcemap` enabled, the mapping for lines containing chunk-to-chunk imports shifts by the length of the added query. The rewrite happens in `generateBundle`, so `renderChunk`'s automatic sourcemap chaining isn't available; since debugging an import specifier itself is a rare scenario, this is documented as a limitation rather than solved
- Since filenames carry no hash, multiple chunks sharing the same `[name]` collide. Rolldown appends a numeric suffix to avoid this, but that suffix is not guaranteed to be stable across builds
- Because deploys overwrite the same paths, a client holding an old HTML page that requests `?v=<old-version>` still receives the new file contents. This is inherent to the query-based approach and cannot be resolved by this plugin

## License

MIT
