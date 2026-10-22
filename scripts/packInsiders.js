'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const readmePath = path.resolve('README.md');
const manifestPath = path.resolve('package.json');
const originalReadme = fs.readFileSync(readmePath);
const originalManifest = fs.readFileSync(manifestPath);

function runYarnScript(script) {
	const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', script], { stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const error = new Error(`yarn run ${script} failed`);
		error.exitCode = result.status ?? 1;
		throw error;
	}
}

try {
	runYarnScript('patch-insiders');
	runYarnScript('pack');
} catch (error) {
	if (error.exitCode == null) {
		console.error(error);
		process.exitCode = 1;
	} else {
		process.exitCode = error.exitCode;
	}
} finally {
	fs.writeFileSync(readmePath, originalReadme);
	fs.writeFileSync(manifestPath, originalManifest);
}
