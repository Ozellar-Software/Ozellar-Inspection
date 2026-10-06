// Uploads the photo files written by migrate.mjs (out/photos/**) to the Azure Blob container, keeping the same paths
// (inspections/<id>/<photoId>.jpg) that the database's photos.blob_path points to. Safe to re-run: existing blobs
// of the same size are skipped.
//
//   node tools/migrate-from-supabase/upload-photos.mjs [--apply] [--dir <out/photos>] [--settings backend/local.settings.json]
//
// Reads PHOTOS_CONNECTION_STRING and PHOTOS_CONTAINER from the environment, or from the settings file. Dry run by default.
import { BlobServiceClient } from '@azure/storage-blob';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const APPLY = argv.includes('--apply');
const DIR = resolve(arg('dir', join(__dirname, 'out', 'photos')));
const settingsFile = resolve(arg('settings', join(__dirname, '..', '..', 'backend', 'local.settings.json')));

let conn = process.env.PHOTOS_CONNECTION_STRING, containerName = process.env.PHOTOS_CONTAINER;
if ((!conn || conn.startsWith('<')) && existsSync(settingsFile)) {
  const v = JSON.parse(readFileSync(settingsFile, 'utf8')).Values ?? {};
  conn = v.PHOTOS_CONNECTION_STRING; containerName = containerName ?? v.PHOTOS_CONTAINER;
}
containerName ??= 'photos';
if (!conn || conn.startsWith('<')) { console.error('PHOTOS_CONNECTION_STRING is not set (still a placeholder?)'); process.exit(1); }
if (!existsSync(DIR)) { console.error(`No photo folder at ${DIR} — run migrate.mjs --apply first`); process.exit(1); }

const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p); else files.push({ path: p, blob: relative(DIR, p).split(sep).join('/'), size: statSync(p).size });
  }
})(DIR);

const account = /AccountName=([^;]+)/.exec(conn)?.[1] ?? '(unknown)';
console.log(`${files.length} files, ${(files.reduce((n, f) => n + f.size, 0) / 1e6).toFixed(1)} MB -> account "${account}", container "${containerName}"${APPLY ? '' : '  [DRY RUN]'}`);

const container = BlobServiceClient.fromConnectionString(conn).getContainerClient(containerName);
if (!(await container.exists())) {
  if (!APPLY) { console.log(`Container "${containerName}" does not exist yet — --apply would create it (private).`); }
  else { await container.create(); console.log(`Created private container "${containerName}"`); }
}

let uploaded = 0, skipped = 0, failed = 0;
const queue = [...files];
async function worker() {
  for (let f; (f = queue.shift());) {
    try {
      const blob = container.getBlockBlobClient(f.blob);
      if (await blob.exists()) {
        if ((await blob.getProperties()).contentLength === f.size) { skipped++; continue; }
      }
      if (APPLY) await blob.uploadFile(f.path, { blobHTTPHeaders: { blobContentType: 'image/jpeg' } });
      uploaded++;
      if (APPLY && uploaded % 20 === 0) console.log(`  …${uploaded} uploaded`);
    } catch (e) { failed++; console.error(`  FAILED ${f.blob}: ${e.message}`); }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

console.log(`\n${APPLY ? 'Uploaded' : 'Would upload'} ${uploaded}, already there ${skipped}, failed ${failed}`);
if (APPLY) {
  let n = 0; for await (const _ of container.listBlobsFlat({ prefix: 'inspections/' })) n++;
  console.log(`Container now holds ${n} blob(s) under inspections/ (expected ${files.filter((f) => f.blob.startsWith('inspections/')).length})`);
}
process.exitCode = failed ? 1 : 0;
