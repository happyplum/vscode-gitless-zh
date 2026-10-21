//@ts-check
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const licenseChecker = require('license-checker');

/** @typedef { { licenses: string; repository: string; licenseFile: string } } PackageInfo **/

const codeOnlyPackages = [
	[
		'microsoft/vscode',
		{
			licenses: 'MIT',
			repository: 'https://github.com/microsoft/vscode',
			licenseFile: path.join(__dirname, 'licenses', 'microsoft-vscode.txt'),
		},
	],
	[
		'chalk/ansi-regex',
		{
			licenses: 'MIT',
			repository: 'https://github.com/chalk/ansi-regex',
			licenseFile: path.join(__dirname, 'licenses', 'chalk-ansi-regex.txt'),
		},
	],
	[
		'sindresorhus/string-width',
		{
			licenses: 'MIT',
			repository: 'https://github.com/sindresorhus/string-width',
			licenseFile: path.join(__dirname, 'licenses', 'sindresorhus-string-width.txt'),
		},
	],
	[
		'sindresorhus/is-fullwidth-code-point',
		{
			licenses: 'MIT',
			repository: 'https://github.com/sindresorhus/is-fullwidth-code-point',
			licenseFile: path.join(__dirname, 'licenses', 'sindresorhus-is-fullwidth-code-point.txt'),
		},
	],
];

/**
 * @param { string } cwd
 * @param { typeof licenseChecker } checker
 */
function getProductionPackages(cwd, checker) {
	return new Promise((resolve, reject) => {
		checker.init({ start: cwd, production: true, relativeLicensePath: true }, (error, packages) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(packages);
		});
	});
}

/**
 * @param { { cwd?: string; checker?: typeof licenseChecker } } [options]
 */
async function generate(options = {}) {
	const cwd = options.cwd || process.cwd();
	const checker = options.checker || licenseChecker;
	const packages = await getProductionPackages(cwd, checker);
	const projectName = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).name;
	const packageOutputs = [];
	const licenseOutputs = [];

	let count = 0;
	for (const [key, data] of Object.entries(packages).concat(codeOnlyPackages)) {
		let name;
		let version;

		const index = key.lastIndexOf('@');
		if (index !== -1) {
			name = key.substr(0, index);
			version = key.substr(index + 1);
		} else {
			name = key;
		}

		if (name === projectName) continue;

		const licensePath = path.isAbsolute(data.licenseFile) ? data.licenseFile : path.resolve(cwd, data.licenseFile);
		const license = fs.readFileSync(licensePath, 'utf8').replace(/[ \t]+(?=\r?$)/gm, '');
		packageOutputs.push(`${++count}. ${name}${version ? ` version ${version}` : ''} (${data.repository})`);
		licenseOutputs.push(
			`\n%% ${name} NOTICES AND INFORMATION BEGIN HERE\n=========================================\n${license}\n=========================================\nEND OF  ${name} NOTICES AND INFORMATION`,
		);
	}

	const content = `GitLens\n\nTHIRD-PARTY SOFTWARE NOTICES AND INFORMATION\nThis project incorporates components from the projects listed below.\n\n${packageOutputs.join(
		'\n',
	)}\n${licenseOutputs.join('\n')}`;
	const outputPath = path.join(cwd, 'ThirdPartyNotices.txt');
	const temporaryPath = `${outputPath}.${process.pid}.tmp`;

	try {
		fs.writeFileSync(temporaryPath, content, 'utf8');
		fs.renameSync(temporaryPath, outputPath);
	} finally {
		if (fs.existsSync(temporaryPath)) {
			fs.rmSync(temporaryPath);
		}
	}
}

if (require.main === module) {
	generate().catch(error => {
		console.error(error);
		process.exitCode = 1;
	});
}

module.exports = { generate };
