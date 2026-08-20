import { createRequire } from "node:module";

/**
 * The server version, read from package.json at runtime rather than copied.
 *
 * This used to be a string literal in index.ts guarded by a
 * `// Keep in sync with package.json` comment. It drifted anyway — see
 * tests/version-sync.test.ts for what that cost. A comment is not a mechanism.
 *
 * `../package.json` resolves the same from both `src/version.ts` (dev/vitest)
 * and `build/version.js` (published), because tsc maps `rootDir: src` onto
 * `outDir: build` and both sit one level below the package root. npm always
 * includes package.json in the tarball regardless of the `files` allow-list,
 * so this resolves for installed consumers too.
 *
 * createRequire rather than a JSON import: an `import ... with { type: "json" }`
 * would pull package.json inside tsc's rootDir and change the build layout.
 */
const require = createRequire(import.meta.url);

export const SERVER_VERSION: string = (require("../package.json") as { version: string }).version;
