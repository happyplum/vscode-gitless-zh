const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach, test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const packScriptPath = path.join(projectRoot, 'scripts', 'packInsiders.js');
const patchScriptPath = path.join(projectRoot, 'scripts', 'applyPatchForInsiders.js');
const temporaryDirectories = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

function createProjectFixture() {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gitless-pack-insiders-'));
	temporaryDirectories.push(directory);
	const scriptsDirectory = path.join(directory, 'scripts');
	fs.mkdirSync(scriptsDirectory);
	fs.copyFileSync(packScriptPath, path.join(scriptsDirectory, 'packInsiders.js'));
	fs.copyFileSync(patchScriptPath, path.join(scriptsDirectory, 'applyPatchForInsiders.js'));
	fs.writeFileSync(path.join(directory, 'README.md'), 'original readme\n');
	fs.writeFileSync(path.join(directory, 'README.insiders.md'), 'insiders header\n');
	fs.writeFileSync(path.join(directory, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');

	const yarnPath = path.join(directory, 'fake-yarn.js');
	fs.writeFileSync(yarnPath, `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const [command, script] = process.argv.slice(2);
assert.equal(command, 'run');
if (script === 'patch-insiders') {
  const result = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'applyPatchForInsiders.js')], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  process.exitCode = result.status;
} else if (script === 'pack') {
  const readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  assert.match(readme, /^insiders header\\n\\noriginal readme\\n/);
  assert.equal(manifest.name, 'fixture-insiders');
  assert.equal(manifest.displayName, 'GitLens (Insiders)');
  if (process.env.FAIL_PACK === '1') {
    process.stderr.write('simulated pack failure\\n');
    process.exitCode = 17;
  }
} else {
  throw new Error('Unexpected Yarn script: ' + script);
}
`);

	return { directory, yarnPath, packScriptPath: path.join(scriptsDirectory, 'packInsiders.js') };
}

function runPackInsiders(fixture, extraEnv = {}) {
	return spawnSync(process.execPath, [fixture.packScriptPath], {
		cwd: fixture.directory,
		encoding: 'utf8',
		env: { ...process.env, npm_execpath: fixture.yarnPath, ...extraEnv },
	});
}

test('patches Insiders files only while packing, then restores their original bytes', () => {
	const fixture = createProjectFixture();
	const readmePath = path.join(fixture.directory, 'README.md');
	const manifestPath = path.join(fixture.directory, 'package.json');
	const originalReadme = fs.readFileSync(readmePath);
	const originalManifest = fs.readFileSync(manifestPath);

	const firstRun = runPackInsiders(fixture);
	assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.stdout);
	assert.deepEqual(fs.readFileSync(readmePath), originalReadme);
	assert.deepEqual(fs.readFileSync(manifestPath), originalManifest);

	const secondRun = runPackInsiders(fixture);
	assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);
	assert.deepEqual(fs.readFileSync(readmePath), originalReadme);
	assert.deepEqual(fs.readFileSync(manifestPath), originalManifest);
});

test('restores the original files when packing fails', () => {
	const fixture = createProjectFixture();
	const readmePath = path.join(fixture.directory, 'README.md');
	const manifestPath = path.join(fixture.directory, 'package.json');
	const originalReadme = fs.readFileSync(readmePath);
	const originalManifest = fs.readFileSync(manifestPath);

	const result = runPackInsiders(fixture, { FAIL_PACK: '1' });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /simulated pack failure/);
	assert.deepEqual(fs.readFileSync(readmePath), originalReadme);
	assert.deepEqual(fs.readFileSync(manifestPath), originalManifest);
});
