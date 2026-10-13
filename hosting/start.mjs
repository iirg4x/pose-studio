import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const settingsFile = path.resolve(process.argv[2]);
const dir = path.dirname(settingsFile);
const settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
const origin = 'http://' + (settings.bindHost ?? '127.0.0.1') + ':' + (settings.port ?? 47831);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(url) {
  try {
    const response = await fetch(url + '/api/catalog', {redirect: 'error', signal: AbortSignal.timeout(3000)});
    if (!response.ok) return false;
    const catalog = await response.json();
    return Array.isArray(catalog.clips);
  } catch { return false; }
}
const records = JSON.parse(await fs.readFile(path.join(dir, 'processes.json'), 'utf8').catch(() => '{}'));
delete records.tunnelPid;
if (!await ready(origin)) {
  const log = await fs.open(path.join(dir, 'server.log'), 'w');
  const child = spawn(process.execPath, ['--max-old-space-size=4096', fileURLToPath(new URL('./server.mjs', import.meta.url)), settingsFile], {
    windowsHide: true, detached: true, stdio: ['ignore', log.fd, log.fd],
  });
  records.hostPid = child.pid;
  child.unref();
  await log.close();
  await fs.writeFile(path.join(dir, 'processes.json'), JSON.stringify(records));
  for (let i = 0; i < 180 && !await ready(origin); i++) await wait(1000);
  if (!await ready(origin)) throw Error('Host failed. See server.log.');
}
await fs.writeFile(path.join(dir, 'processes.json'), JSON.stringify(records));

// Remote access is configured separately. Starting the project never creates
// an account, opens a tunnel, or silently chooses a different address.
let publicUrl = null;
if (settings.publicUrl) {
  const url = new URL(settings.publicUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw Error('The public project address must be an HTTPS origin.');
  }
  if (!await ready(url.origin)) throw Error('The configured public address is offline. The local project is still running.');
  publicUrl = url.origin;
}
const projectUrl = publicUrl ?? origin;
const shortcut = '[InternetShortcut]\r\nURL=' + projectUrl + '\r\n';
await fs.writeFile(path.join(dir, 'Open project.url'), shortcut);
if (settings.shortcut) await fs.writeFile(settings.shortcut, shortcut);
await fs.writeFile(path.join(dir, 'sharing-status.json'), JSON.stringify({local: 'running', remote: publicUrl ? 'running' : 'not-configured', projectUrl, publicUrl}, null, 2));
console.log('Project available at ' + projectUrl);
