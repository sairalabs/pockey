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
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

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

/**
 * When the file last changed, from git rather than from the filesystem: a
 * checkout stamps every file with the time of the checkout, so an mtime here
 * would only ever say "now". A shallow clone may not reach the commit that
 * last touched a file, and then there is no date and the sitemap omits it,
 * which is better than inventing one.
 */
async function lastChanged(file) {
  try {
    const { stdout } = await run('git', ['log', '-1', '--format=%cI', '--', file], { cwd: ROOT });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

const updated = {};

for (const file of FILES) {
  await copyFile(path.join(ROOT, file), path.join(OUT, path.basename(file)));
  const date = await lastChanged(file);
  if (date) updated[file] = date;
}

await writeFile(path.join(OUT, 'updated.json'), `${JSON.stringify(updated, null, 2)}\n`);

const written = await readdir(OUT);
console.log(`collect-docs: ${written.length} files into apps/site/content`);
