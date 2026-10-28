'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createVSIX, publishVSIX } = require('@vscode/vsce');
const { generateExtension } = require('./extensionManifest');

async function packExtension({ insiders = false, publish = false } = {}) {
	const projectRoot = path.resolve(__dirname, '..');
	const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'bundle'], {
		cwd: projectRoot,
		stdio: 'inherit',
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const error = new Error('yarn run bundle failed');
		error.exitCode = result.status ?? 1;
		throw error;
	}
	const extensionRoot = generateExtension({ projectRoot, insiders });
	const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
	const packagePath = path.join(projectRoot, `${manifest.name}-${manifest.version}.vsix`);
	await createVSIX({ cwd: extensionRoot, dependencies: false, packagePath });
	if (publish) await publishVSIX(packagePath);
	return packagePath;
}

function reportError(error) {
	console.error(error);
	process.exitCode = error.exitCode ?? 1;
}

module.exports = { packExtension, reportError };

if (require.main === module) packExtension({ publish: process.argv.includes('--publish') }).catch(reportError);
