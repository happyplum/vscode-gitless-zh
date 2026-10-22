const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const contributionKeys = [
	'configuration',
	'configurationDefaults',
	'colors',
	'commands',
	'menus',
	'submenus',
	'keybindings',
	'customEditors',
	'resourceLabelFormatters',
	'viewsContainers',
	'viewsWelcome',
	'views',
];
const temporaryDirectories = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeFile(directory, relativePath, contents) {
	const file = path.join(directory, relativePath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, contents);
}

function createFixture() {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gitless-extension-manifest-'));
	temporaryDirectories.push(directory);
	writeFile(
		directory,
		'package.json',
		JSON.stringify({
			name: 'fixture',
			displayName: 'Fixture',
			version: '1.2.3',
			main: './dist/gitlens',
			preview: false,
			scripts: { 'vscode:prepublish': 'must not run from generated extension' },
		}),
	);
	for (const key of contributionKeys) {
		writeFile(directory, `manifest/${key}.json`, JSON.stringify({ sample: key }));
	}
	writeFile(directory, 'README.md', 'original readme\n');
	writeFile(directory, 'README.insiders.md', 'insiders header\n');
	writeFile(directory, 'CHANGELOG.md', 'changelog\n');
	writeFile(directory, 'LICENSE', 'license\n');
	writeFile(directory, 'ThirdPartyNotices.txt', 'third party notices\n');
	writeFile(directory, 'BACKERS.md', 'backers\n');
	writeFile(directory, '.nvmrc', '22\n');
	writeFile(directory, 'eslint.config.cjs', 'module.exports = [];\n');
	writeFile(directory, '.vscodeignore', 'dist/webviews/*.css\n');
	writeFile(directory, 'images/icon.png', 'icon');
	writeFile(directory, 'images/views/branch.svg', 'branch');
	writeFile(directory, 'images/settings/stale.webp', 'obsolete root build output');
	return directory;
}

function generate(directory, options = {}) {
	const { generateExtension } = require('../scripts/extensionManifest');
	generateExtension({ projectRoot: directory, ...options });
	return path.join(directory, 'dist', 'extension');
}

test('root manifest is small and Stable generation composes all source contributions in order', () => {
	const root = readJson(path.join(projectRoot, 'package.json'));
	assert.equal(Object.hasOwn(root, 'contributes'), false);
	assert.ok(fs.statSync(path.join(projectRoot, 'package.json')).size < 12000);
	const fragments = Object.fromEntries(
		contributionKeys.map(key => [key, readJson(path.join(projectRoot, 'manifest', `${key}.json`))]),
	);
	const directory = createFixture();
	writeFile(directory, 'package.json', JSON.stringify(root));
	for (const key of contributionKeys) {
		writeFile(directory, `manifest/${key}.json`, JSON.stringify(fragments[key]));
	}
	const generated = readJson(path.join(generate(directory), 'package.json'));
	const { scripts: _scripts, ...expectedMetadata } = root;
	assert.deepEqual(generated, { ...expectedMetadata, contributes: fragments });
	assert.equal(JSON.stringify(generated.contributes), JSON.stringify(fragments));
});

test('generation is deterministic, omits development scripts and preserves source bytes', () => {
	const directory = createFixture();
	const originalManifest = fs.readFileSync(path.join(directory, 'package.json'));
	const originalReadme = fs.readFileSync(path.join(directory, 'README.md'));
	const output = generate(directory);
	const firstManifest = fs.readFileSync(path.join(output, 'package.json'));
	const generated = JSON.parse(firstManifest);
	assert.equal(Object.hasOwn(generated, 'scripts'), false);
	assert.equal(generated.main, './dist/gitlens');
	assert.deepEqual(Object.keys(generated.contributes), contributionKeys);
	generate(directory);
	assert.deepEqual(fs.readFileSync(path.join(output, 'package.json')), firstManifest);
	assert.deepEqual(fs.readFileSync(path.join(directory, 'package.json')), originalManifest);
	assert.deepEqual(fs.readFileSync(path.join(directory, 'README.md')), originalReadme);
});

test('Insiders uses the existing New York date and README prefix without mutating sources', () => {
	const directory = createFixture();
	const originalManifest = fs.readFileSync(path.join(directory, 'package.json'));
	const originalReadme = fs.readFileSync(path.join(directory, 'README.md'));
	const output = generate(directory, { insiders: true, now: new Date('2026-01-01T02:30:00Z') });
	const generated = readJson(path.join(output, 'package.json'));
	assert.equal(generated.name, 'fixture-insiders');
	assert.equal(generated.displayName, 'GitLens (Insiders)');
	assert.equal(generated.version, '2025.12.3121');
	assert.equal(generated.preview, true);
	assert.equal(fs.readFileSync(path.join(output, 'README.md'), 'utf8'), 'insiders header\n\noriginal readme\n');
	assert.deepEqual(fs.readFileSync(path.join(directory, 'package.json')), originalManifest);
	assert.deepEqual(fs.readFileSync(path.join(directory, 'README.md')), originalReadme);
	generate(directory);
	assert.equal(readJson(path.join(output, 'package.json')).name, 'fixture');
	assert.deepEqual(fs.readFileSync(path.join(output, 'README.md')), originalReadme);
});

test('resource synchronization reflects edits and deletions while preserving compiler outputs', () => {
	const directory = createFixture();
	const output = generate(directory);
	for (const file of [
		'README.md',
		'CHANGELOG.md',
		'LICENSE',
		'ThirdPartyNotices.txt',
		'images/icon.png',
		'images/views/branch.svg',
	]) {
		assert.deepEqual(fs.readFileSync(path.join(output, file)), fs.readFileSync(path.join(directory, file)), file);
	}
	assert.equal(fs.existsSync(path.join(output, 'images/settings/stale.webp')), false);
	writeFile(output, 'dist/gitlens.js', 'extension compiler output');
	writeFile(output, 'dist/webviews/settings.html', 'webviews compiler output');
	writeFile(output, 'images/settings/current.webp', 'webviews generated image');
	writeFile(directory, 'images/icon.png', 'edited icon');
	writeFile(directory, 'images/views/new.svg', 'new image');
	writeFile(directory, 'README.md', 'edited readme');
	fs.unlinkSync(path.join(directory, 'images/views/branch.svg'));
	generate(directory);
	assert.equal(fs.readFileSync(path.join(output, 'images/icon.png'), 'utf8'), 'edited icon');
	assert.equal(fs.readFileSync(path.join(output, 'images/views/new.svg'), 'utf8'), 'new image');
	assert.equal(fs.readFileSync(path.join(output, 'README.md'), 'utf8'), 'edited readme');
	assert.equal(fs.existsSync(path.join(output, 'images/views/branch.svg')), false);
	assert.equal(fs.readFileSync(path.join(output, 'dist/gitlens.js'), 'utf8'), 'extension compiler output');
	assert.equal(fs.readFileSync(path.join(output, 'dist/webviews/settings.html'), 'utf8'), 'webviews compiler output');
	assert.equal(
		fs.readFileSync(path.join(output, 'images/settings/current.webp'), 'utf8'),
		'webviews generated image',
	);
});
