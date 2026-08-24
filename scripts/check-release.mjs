import { readFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const errors = [];

if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
if (manifest.permissions?.includes('tabs')) errors.push('the redundant tabs permission must not ship');
if (manifest.host_permissions?.includes('<all_urls>')) errors.push('<all_urls> must not ship');
if (manifest.description.length > 132) errors.push('manifest description exceeds 132 characters');

for (const path of [
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'fonts/OFL.txt',
  'src/pages/privacy/privacy.html',
  'store/listing.md',
  'store/privacy-practices.md',
  'store/reviewer-notes.md'
]) {
  try {
    await access(path);
  } catch {
    errors.push(`missing required publication file: ${path}`);
  }
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

for (const file of (await filesUnder('src')).filter((path) => path.endsWith('.js'))) {
  const source = await readFile(file, 'utf8');
  if (/\b(?:eval|Function)\s*\(/.test(source)) errors.push(`remote-code-sensitive construct found in ${file}`);
  if (/\bfetch\s*\(/.test(source)) errors.push(`network request found in ${file}; review and declare it: fetch()`);
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Release checks passed for Lock In ${manifest.version}.`);
}
