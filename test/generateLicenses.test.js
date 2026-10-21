const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach, test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const generatorPath = path.join(projectRoot, 'scripts', 'generateLicenses.js');
const temporaryDirectories = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

function createProjectFixture(packageJson, linkNodeModules = true) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gitless-notices-'));
	temporaryDirectories.push(directory);
	fs.writeFileSync(path.join(directory, 'package.json'), packageJson);
	if (linkNodeModules) {
		fs.symlinkSync(path.join(projectRoot, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
	}
	const scriptDirectory = path.join(directory, 'scripts');
	fs.mkdirSync(scriptDirectory);
	fs.copyFileSync(generatorPath, path.join(scriptDirectory, 'generateLicenses.js'));
	const licenseDirectory = path.join(projectRoot, 'scripts', 'licenses');
	if (fs.existsSync(licenseDirectory)) {
		fs.cpSync(licenseDirectory, path.join(scriptDirectory, 'licenses'), { recursive: true });
	}
	return { directory, scriptPath: path.join(scriptDirectory, 'generateLicenses.js') };
}

test('writes notices for the production dependency closure and all four bundled licenses', () => {
	const { directory, scriptPath } = createProjectFixture(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
	const result = spawnSync(process.execPath, [scriptPath], { cwd: directory, encoding: 'utf8' });

	assert.equal(result.status, 0, result.stderr || result.stdout);
	const notices = fs.readFileSync(path.join(directory, 'ThirdPartyNotices.txt'), 'utf8');
	assert.match(notices, /lodash-es version 4\.18\.1/);
	assert.match(notices, /%% microsoft\/vscode NOTICES AND INFORMATION BEGIN HERE/);
	assert.match(notices, /%% chalk\/ansi-regex NOTICES AND INFORMATION BEGIN HERE/);
	assert.match(notices, /%% sindresorhus\/string-width NOTICES AND INFORMATION BEGIN HERE/);
	assert.match(notices, /%% sindresorhus\/is-fullwidth-code-point NOTICES AND INFORMATION BEGIN HERE/);
});

test('keeps the existing notices when dependency discovery fails and reports failure', () => {
	const { directory, scriptPath } = createProjectFixture('{}', false);
	const noticesPath = path.join(directory, 'ThirdPartyNotices.txt');
	fs.writeFileSync(noticesPath, 'previous notices');
	const result = spawnSync(process.execPath, [scriptPath], {
		cwd: directory,
		encoding: 'utf8',
		env: { ...process.env, NODE_PATH: path.join(projectRoot, 'node_modules') },
	});

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /No packages found in this path/);
	assert.equal(fs.readFileSync(noticesPath, 'utf8'), 'previous notices');
});
