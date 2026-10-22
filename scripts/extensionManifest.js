'use strict';

const fs = require('node:fs');
const path = require('node:path');

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
// Preserve the static files shipped by the root-based VSIX before this migration.
const staticFiles = [
	'README.md',
	'README.insiders.md',
	'CHANGELOG.md',
	'LICENSE',
	'ThirdPartyNotices.txt',
	'BACKERS.md',
	'.nvmrc',
	'eslint.config.cjs',
	'.vscodeignore',
];

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function syncImages(source, destination, root = true) {
	fs.mkdirSync(destination, { recursive: true });
	const entries = fs.readdirSync(source, { withFileTypes: true });
	const names = new Set();
	for (const entry of entries) {
		// Settings images belong to the webviews compiler, including its deletion handling.
		if (root && ['settings', 'docs', 'originals'].includes(entry.name)) continue;
		if (/\.(fig|pdn)$/.test(entry.name)) continue;
		names.add(entry.name);
		const from = path.join(source, entry.name);
		const to = path.join(destination, entry.name);
		if (entry.isDirectory()) syncImages(from, to, false);
		else fs.copyFileSync(from, to);
	}
	for (const entry of fs.readdirSync(destination, { withFileTypes: true })) {
		if (root && entry.name === 'settings') continue;
		if (!names.has(entry.name)) fs.rmSync(path.join(destination, entry.name), { recursive: true, force: true });
	}
}

function generateExtension({ projectRoot = path.resolve(__dirname, '..'), insiders = false, now = new Date() } = {}) {
	const { scripts: _scripts, ...metadata } = readJson(path.join(projectRoot, 'package.json'));
	const contributes = Object.fromEntries(
		contributionKeys.map(key => [key, readJson(path.join(projectRoot, 'manifest', `${key}.json`))]),
	);
	const manifest = { ...metadata, contributes };
	if (insiders) {
		const date = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
		manifest.name += '-insiders';
		manifest.displayName = 'GitLens (Insiders)';
		manifest.version = `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}${String(date.getHours()).padStart(2, '0')}`;
		manifest.preview = true;
	}
	const extensionRoot = path.join(projectRoot, 'dist', 'extension');
	fs.mkdirSync(extensionRoot, { recursive: true });
	fs.writeFileSync(path.join(extensionRoot, 'package.json'), JSON.stringify(manifest, null, '\t') + '\n');
	for (const file of staticFiles) {
		fs.copyFileSync(path.join(projectRoot, file), path.join(extensionRoot, file));
	}
	if (insiders) {
		const prefix = fs.readFileSync(path.join(projectRoot, 'README.insiders.md'), 'utf8');
		const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
		fs.writeFileSync(path.join(extensionRoot, 'README.md'), `${prefix}\n${readme}`);
	}
	syncImages(path.join(projectRoot, 'images'), path.join(extensionRoot, 'images'));
	return extensionRoot;
}

class ExtensionManifestPlugin {
	constructor(projectRoot) {
		this.projectRoot = projectRoot;
	}

	apply(compiler) {
		const generate = () => generateExtension({ projectRoot: this.projectRoot });
		compiler.hooks.beforeRun.tap('ExtensionManifestPlugin', generate);
		compiler.hooks.watchRun.tap('ExtensionManifestPlugin', generate);
		compiler.hooks.afterCompile.tap('ExtensionManifestPlugin', compilation => {
			if (compilation.compiler !== compiler) return;
			for (const file of ['package.json', ...staticFiles]) {
				compilation.fileDependencies.add(path.join(this.projectRoot, file));
			}
			compilation.contextDependencies.add(path.join(this.projectRoot, 'manifest'));
			compilation.contextDependencies.add(path.join(this.projectRoot, 'images'));
		});
	}
}

module.exports = { generateExtension, ExtensionManifestPlugin };

if (require.main === module) generateExtension();
