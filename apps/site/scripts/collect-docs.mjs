/**
 * Copies the repository's markdown into this app before a build.
 *
 * The documentation has one source, the files at the repository root, and the
 * site renders those. Reading them across the monorepo at build time makes Next
 * trace the whole repository into the server output, so they are brought inside
 * the app first and read from a statically scoped path.
 *
 * `content/` is generated and gitignored. Run it again after editing a doc.
 */
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(APP, '../..');
const OUT = path.join(APP, 'content');

/** Must match the files named in src/lib/doc-list.ts. */
const FILES = [
  'README.md',
  'SECURITY.md',
  'TURNKEY.md',
  'CONTRIBUTING.md',
  'docs/self-hosting.md',
  'docs/decisions.md',
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const file of FILES) {
  await copyFile(path.join(ROOT, file), path.join(OUT, path.basename(file)));
}

const written = await readdir(OUT);
console.log(`collect-docs: ${written.length} files into apps/site/content`);
