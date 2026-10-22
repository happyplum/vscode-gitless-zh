const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach, test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const temporaryDirectories = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

function writeFile(directory, relativePath, contents) {
	const file = path.join(directory, relativePath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, contents);
}

function createProjectFixture() {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gitless-pack-extension-'));
	temporaryDirectories.push(directory);
	for (const file of ['packInsiders.js', 'packExtension.js', 'extensionManifest.js']) {
		writeFile(directory, 'scripts/' + file, fs.readFileSync(path.join(projectRoot, 'scripts', file)));
	}
	fs.cpSync(path.join(projectRoot, 'manifest'), path.join(directory, 'manifest'), { recursive: true });
	for (const file of [
		'CHANGELOG.md',
		'LICENSE',
		'ThirdPartyNotices.txt',
		'BACKERS.md',
		'.nvmrc',
		'eslint.config.cjs',
		'.vscodeignore',
	]) {
		writeFile(directory, file, file + '\n');
	}
	writeFile(directory, 'images/icon.png', 'icon');
	writeFile(directory, 'README.md', 'original readme\n');
	writeFile(directory, 'README.insiders.md', 'insiders header\n');
	writeFile(
		directory,
		'package.json',
		'{"name":"fixture","version":"1.0.0","scripts":{"vscode:prepublish":"must not run"}}\n',
	);
	const yarnPath = path.join(directory, 'fake-yarn.js');
	writeFile(
		directory,
		'fake-yarn.js',
		`
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
assert.deepEqual(process.argv.slice(2), ['run', 'bundle']);
assert.equal(JSON.parse(fs.readFileSync('package.json', 'utf8')).name, 'fixture');
assert.equal(fs.readFileSync('README.md', 'utf8'), 'original readme\\n');
if (process.env.FAIL_BUNDLE === '1') {
  process.stderr.write('simulated bundle failure\\n');
  process.exitCode = 19;
} else {
  fs.mkdirSync('dist/extension/dist', { recursive: true });
  fs.writeFileSync('dist/extension/dist/gitlens.js', 'compiled');
}
`,
	);
	writeFile(
		directory,
		'node_modules/@vscode/vsce/index.js',
		`
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
exports.createVSIX = async options => {
  const root = path.resolve(__dirname, '../../..');
  assert.equal(options.cwd, path.join(root, 'dist/extension'));
  assert.equal(options.dependencies, false);
  const manifest = JSON.parse(fs.readFileSync(path.join(options.cwd, 'package.json'), 'utf8'));
  const insiders = process.env.EXPECT_INSIDERS === '1';
  assert.equal(manifest.name, insiders ? 'fixture-insiders' : 'fixture');
  assert.equal(Object.hasOwn(manifest, 'scripts'), false);
  if (insiders) assert.equal(manifest.displayName, 'GitLens (Insiders)');
  assert.equal(fs.readFileSync(path.join(options.cwd, 'README.md'), 'utf8'),
    insiders ? 'insiders header\\n\\noriginal readme\\n' : 'original readme\\n');
  assert.equal(fs.readFileSync(path.join(options.cwd, 'dist/gitlens.js'), 'utf8'), 'compiled');
  assert.equal(options.packagePath, path.join(root, manifest.name + '-' + manifest.version + '.vsix'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name, 'fixture');
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'original readme\\n');
  if (process.env.FAIL_PACK === '1') throw Object.assign(new Error('simulated pack failure'), { exitCode: 17 });
  fs.writeFileSync(options.packagePath, 'packaged');
  fs.writeFileSync(path.join(root, 'packaged-path.txt'), options.packagePath);
};
exports.publishVSIX = async packagePath => {
  assert.equal(fs.readFileSync(packagePath, 'utf8'), 'packaged');
  fs.writeFileSync(path.join(path.dirname(packagePath), 'published-path.txt'), packagePath);
};
`,
	);
	return { directory, yarnPath };
}

function runPack(fixture, { insiders = true, publish = false, env = {} } = {}) {
	return spawnSync(
		process.execPath,
		[
			path.join(fixture.directory, 'scripts', insiders ? 'packInsiders.js' : 'packExtension.js'),
			...(publish ? ['--publish'] : []),
		],
		{
			cwd: fixture.directory,
			encoding: 'utf8',
			env: { ...process.env, npm_execpath: fixture.yarnPath, EXPECT_INSIDERS: insiders ? '1' : '0', ...env },
		},
	);
}

function assertSourcesUnchanged(fixture, originalManifest, originalReadme) {
	assert.deepEqual(fs.readFileSync(path.join(fixture.directory, 'package.json')), originalManifest);
	assert.deepEqual(fs.readFileSync(path.join(fixture.directory, 'README.md')), originalReadme);
}

test('packages Insiders repeatedly from generated files without ever patching source files', () => {
	const fixture = createProjectFixture();
	const originalManifest = fs.readFileSync(path.join(fixture.directory, 'package.json'));
	const originalReadme = fs.readFileSync(path.join(fixture.directory, 'README.md'));
	for (let run = 0; run < 2; run++) {
		const result = runPack(fixture);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		assertSourcesUnchanged(fixture, originalManifest, originalReadme);
	}
});

test('preserves source files and failure exit codes when bundle or packaging fails', () => {
	for (const [env, expectedStatus, message] of [
		[{ FAIL_BUNDLE: '1' }, 19, /simulated bundle failure/],
		[{ FAIL_PACK: '1' }, 17, /simulated pack failure/],
	]) {
		const fixture = createProjectFixture();
		const originalManifest = fs.readFileSync(path.join(fixture.directory, 'package.json'));
		const originalReadme = fs.readFileSync(path.join(fixture.directory, 'README.md'));
		const result = runPack(fixture, { env });
		assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
		assert.match(result.stderr, message);
		assertSourcesUnchanged(fixture, originalManifest, originalReadme);
		assert.equal(fs.existsSync(path.join(fixture.directory, 'packaged-path.txt')), false);
	}
});

test('Stable packaging uses the same generated directory and pub publishes its resulting VSIX', () => {
	const fixture = createProjectFixture();
	const result = runPack(fixture, { insiders: false, publish: true });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const expectedPackagePath = path.join(fixture.directory, 'fixture-1.0.0.vsix');
	assert.equal(fs.readFileSync(path.join(fixture.directory, 'packaged-path.txt'), 'utf8'), expectedPackagePath);
	assert.equal(fs.readFileSync(path.join(fixture.directory, 'published-path.txt'), 'utf8'), expectedPackagePath);
});
