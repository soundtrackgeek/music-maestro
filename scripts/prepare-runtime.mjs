// Build-time provisioner. End users receive this helper inside the installer.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const resources = resolve('src-tauri/resources');
const helper = resolve(resources, 'uv.exe');
const archiveHash = 'acfde570451cfdb8689fa159a138ee805ba4e241c466432750302c86254b0984';
const version = '0.11.32';
const helperHash = '23cf0f8194ff576562646a1a2950c6826249c8806cd1547debd24db77eb68f58';
const wheelHash = 'c843f47d4f160c854e079a3d7f7bbbc60f90309ca3e38b75ed29250991cdd91a';
mkdirSync(resources, { recursive: true });
if (
  !existsSync(helper) ||
  createHash('sha256').update(readFileSync(helper)).digest('hex') !== helperHash
) {
  console.log(`Preparing the bundled uv ${version} runtime helper…`);
  const response = await fetch(
    `https://github.com/astral-sh/uv/releases/download/${version}/uv-x86_64-pc-windows-msvc.zip`,
  );
  if (!response.ok) throw new Error(`Runtime helper download failed (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(buffer).digest('hex') !== archiveHash)
    throw new Error('Runtime helper checksum mismatch');
  const archive = resolve(resources, 'uv.zip');
  const unpack = resolve(resources, 'uv-unpack');
  writeFileSync(archive, buffer);
  // Arguments go through a script file; no user-controlled shell text is interpolated.
  const script = resolve(resources, 'unpack-runtime.ps1');
  writeFileSync(
    script,
    'param($Archive,$Destination)\nExpand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force\n',
  );
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, archive, unpack],
    { windowsHide: true },
  );
  const direct = resolve(unpack, 'uv.exe');
  const nested = resolve(unpack, 'uv-x86_64-pc-windows-msvc/uv.exe');
  copyFileSync(existsSync(direct) ? direct : nested, helper);
  if (createHash('sha256').update(readFileSync(helper)).digest('hex') !== helperHash)
    throw new Error('Extracted runtime helper checksum mismatch');
  // Only remove exact paths generated above, within the owned resources directory.
  for (const file of [archive, script]) rmSync(file);
  rmSync(unpack, { recursive: true, force: true });
}
const wheel = resolve(resources, 'yue2_infer-0.1.6-py3-none-any.whl');
if (!existsSync(wheel))
  throw new Error('The pinned YuE2 inference wheel is missing from the checkout.');
if (createHash('sha256').update(readFileSync(wheel)).digest('hex') !== wheelHash)
  throw new Error('The pinned YuE2 inference wheel checksum differs from its source record.');
console.log('Bundled runtime resources ready.');
