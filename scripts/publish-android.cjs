// Publish only the app APK and update manifest; never include project documents.
// Build with npm run android:apk first. Preview: node scripts/publish-android.cjs
// Publish: node scripts/publish-android.cjs --publish
const fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'),
  repo = 'iirg4x/pose-releases';
const gh = (args) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
(async () => {
  const version = require('../package.json').version,
    gradle = await fs.readFile(path.join(root, 'android/app/build.gradle'), 'utf8'),
    code = Number(gradle.match(/poseVersionCode'\) \?: '(\d+)'/)?.[1]);
  if (!/^\d+\.\d+\.\d+$/.test(version) || !code) throw Error('Invalid release version.');
  const name = 'Pose-' + version + '-android.apk',
    apk = path.join(root, 'android-build', name),
    bytes = await fs.readFile(apk),
    sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const manifest = {
    schema: 1,
    android: {
      version,
      versionCode: code,
      url: 'https://github.com/' + repo + '/releases/download/v' + version + '/' + name,
      size: bytes.length,
      sha256,
      notes:
        'Curve and control key locks prevent new keys while keeping existing keys and tangents editable. Live animation mirroring drives the opposite side half a cycle later, with a same-frame option, preserving original destination animation for unlinking. Linked curves are read-only with a direct Edit source action.',
    },
  };
  const destination = path.join(root, 'android-build', 'pose-update.json');
  await fs.writeFile(destination, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest, null, 2));
  if (!process.argv.includes('--publish')) return;
  const notes = path.join(root, 'android-build', 'release-notes.txt');
  await fs.writeFile(
    notes,
    'Pose ' +
      version +
      ' for Android\n\n' +
      'Curve and control key locks prevent new keys while keeping existing keys and tangents editable. Live animation mirroring drives the opposite side half a cycle later, with a same-frame option, preserving original destination animation for unlinking. Linked curves are read-only with a direct Edit source action.\n\nVerified in desktop and touch browser layouts. No emulator used. Project files are unchanged.\n',
  );
  // A draft keeps latest readers on the previous complete release during upload.
  gh([
    'release',
    'create',
    'v' + version,
    apk,
    destination,
    '--repo',
    repo,
    '--title',
    'Pose ' + version,
    '--notes-file',
    notes,
    '--draft',
  ]);
  const release = JSON.parse(
    gh(['release', 'view', 'v' + version, '--repo', repo, '--json', 'assets']),
  );
  if (
    !release.assets.some((a) => a.name === name && a.size === bytes.length) ||
    !release.assets.some((a) => a.name === 'pose-update.json')
  )
    throw Error('Release upload verification failed; draft retained.');
  gh(['release', 'edit', 'v' + version, '--repo', repo, '--draft=false', '--latest']);
  console.log(gh(['release', 'view', 'v' + version, '--repo', repo, '--json', 'url,assets']));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
