const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const noop = () => {};
const disposable = () => ({ dispose: noop });
const decorator = () => () => undefined;

function repository(repoPath) {
	const listeners = new Set();
	return {
		path: repoPath, normalizedPath: `${repoPath.toLowerCase()}/`, updatedAt: 0,
		formattedName: path.basename(repoPath), supportsChangeEvents: true,
		getBranch: async () => undefined,
		onDidChange(fn, context) {
			const listener = event => fn.call(context, event);
			listeners.add(listener);
			return { dispose: () => listeners.delete(listener) };
		},
		emit(change) { for (const listener of listeners) listener({ changed: (...changes) => changes.includes(change) }); },
		get subscriptions() { return listeners.size; },
	};
}

function worktree(repoPath, main = false) {
	return { path: repoPath, main, branch: 'refs/heads/main', head: 'a'.repeat(40) };
}

function loadView(repositories, listings, isWindows = true) {
	const loaded = new Map();
	const changes = [];
	class GitUri { static fromRepoPath(repoPath) { return { repoPath }; } }
	class TreeItem { constructor(label, collapsibleState) { Object.assign(this, { label, collapsibleState }); } }
	const git = {
		getOrderedRepositories: async () => repositories,
		getWorktrees: async repoPath => {
			const result = listings.get(repoPath);
			if (result instanceof Error) throw result;
			assert.ok(result, `Missing fixture ${repoPath}`);
			return result;
		},
		getBranch: async () => undefined,
		getLog: async () => undefined,
		getStatusForRepo: async () => ({ files: [] }),
		isActiveRepoPath: async () => false,
	};
	const system = {
		debug: decorator, gate: decorator, log: decorator, logName: () => constructor => constructor,
		Functions: { is: (object, key) => typeof object[key] === 'function' },
		Strings: { normalizePath: p => p.replace(/\\/g, '/').replace(/\/$/, '').replace(/^([A-Z]):/, d => d.toLowerCase()) },
	};
	const gitTypes = {
		RepositoryChange: Object.fromEntries(['Config', 'Heads', 'Index', 'Remotes', 'Status', 'Tags', 'Unknown', 'Closed', 'Starred'].map(key => [key, key])),
		RepositoryChangeComparisonMode: { Any: 'Any' },
	};
	const vscode = {
		TreeItem, TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
		ThemeIcon: class { constructor(id) { this.id = id; } },
		Uri: { parse: text => text },
		Disposable: { from: (...items) => ({ dispose: () => items.forEach(item => item.dispose()) }) },
		window: {},
	};
	function load(relative) {
		if (loaded.has(relative)) return loaded.get(relative).exports;
		const module = { exports: {} };
		loaded.set(relative, module);
		const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
			compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true },
		}).outputText;
		new Function('require', 'module', 'exports', code)(name => {
			if (name === 'vscode') return vscode;
			if (name === 'path') return path;
			const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), `${name}.ts`));
			if (resolved === 'src/container.ts') return { Container: { git } };
			if (resolved === 'src/git/git.ts') return gitTypes;
			if (resolved === 'src/git/shell.ts') return { isWindows };
			if (resolved === 'src/git/gitUri.ts') return { GitUri };
			if (resolved === 'src/system.ts') return system;
			if (resolved === 'src/logger.ts') return { Logger: { toLoggableName: () => 'Node' } };
			if (resolved === 'src/constants.ts') return { GlyphChars: { Check: '✓' } };
			if (resolved === 'src/commands/common.ts') return { Commands: {} };
			if (resolved === 'src/views/viewBase.ts') return { ViewBase: class {} };
			if (resolved === 'src/views/nodes/repositoryNode.ts') return { RepositoryNode: { getId: value => value } };
			if (resolved === 'src/views/nodes/common.ts') return { MessageNode: class { constructor(_view, parent, message) { this.parent = parent; this.message = message; } } };
			if (resolved === 'src/views/nodes/helpers.ts') return { insertDateMarkers: nodes => [...nodes] };
			if (resolved === 'src/views/nodes/commitNode.ts') return {};
			return load(resolved);
		}, module, module.exports);
		return module.exports;
	}
	const { WorktreesView } = load('src/views/worktreesView.ts');
	const view = {
		id: 'gitlens.views.worktrees', visible: true, config: { defaultItemLimit: 20 },
		getNodeLastKnownLimit: noop,
		onDidChangeVisibility: disposable, onDidChangeNodeCollapsibleState: disposable,
		refreshNode: async (node, reset) => { changes.push(node); await node.refresh?.(reset); },
	};
	return { node: WorktreesView.prototype.getRoot.call(view), view, changes };
}

test('one repository renders worktrees directly with no hidden parent in the visible chain', async () => {
	const repo = repository('C:/repo');
	const expected = [worktree(repo.path, true), worktree('C:/linked')];
	const { node } = loadView([repo], new Map([[repo.path, expected]]));
	const rows = await node.getChildren();
	assert.deepEqual(rows.map(row => row.worktree?.path), expected.map(w => w.path));
	assert.equal(rows[0].getParent(), undefined);
	assert.ok(await node.getSplattedChild());
});

test('multiple open worktrees of the same Git repository produce one flat list', async () => {
	const repos = [repository('C:/repo'), repository('C:/linked')];
	const family = [worktree('C:/repo', true), worktree('C:/linked'), worktree('C:/closed')];
	const { node } = loadView(repos, new Map(repos.map(repo => [repo.path, family])));
	const rows = await node.getChildren();
	assert.deepEqual(rows.map(row => row.worktree?.path), family.map(w => w.path));
	const items = await Promise.all(rows.map(row => row.getTreeItem()));
	assert.equal(items[0].description, 'main · 当前工作树 · 主工作树');
	assert.equal(items[1].description, 'main · 当前工作树');
	assert.doesNotMatch(String(items[2].description), /当前工作树/);
});

test('path comparison folds Windows casing and separators without merging case-sensitive paths', async () => {
	const repos = [repository('C:\\REPO\\'), repository('c:/linked')];
	const family = [worktree('c:/repo', true), worktree('C:/LINKED')];
	const listings = new Map(repos.map(repo => [repo.path, family]));
	const rows = await loadView(repos, listings).node.getChildren();
	assert.equal(rows.length, 2);
	for (const row of rows) assert.match((await row.getTreeItem()).description, /当前工作树/);
	const linuxRepos = [repository('/Repo'), repository('/repo')];
	const groups = await loadView(linuxRepos, new Map(linuxRepos.map(repo => [repo.path, [worktree(repo.path, true)]])), false).node.getChildren();
	assert.equal(groups.length, 2);
	assert.ok(groups.every(group => group.repo));
});

test('hidden non-representative changes rebuild the group when it becomes visible', async () => {
	const repos = [repository('C:/repo'), repository('C:/linked')];
	const family = [worktree('C:/repo', true), worktree('C:/linked')];
	const { node, view, changes } = loadView(repos, new Map(repos.map(repo => [repo.path, family])));
	await node.getChildren();
	const group = await node.getSplattedChild();
	view.visible = false;
	group.onVisibilityChanged({ visible: false });
	await new Promise(resolve => setImmediate(resolve));
	repos[1].updatedAt++;
	view.visible = true;
	group.onVisibilityChanged({ visible: true });
	await new Promise(resolve => setImmediate(resolve));
	assert.ok(changes.includes(node));
});

test('refresh discards the prefetched listing even before a group is expanded', async () => {
	const repos = [repository('C:/one'), repository('C:/two')];
	const listings = new Map(repos.map(repo => [repo.path, [worktree(repo.path, true)]]));
	const { node } = loadView(repos, listings);
	const groups = await node.getChildren();
	listings.set(repos[0].path, [worktree(repos[0].path, true), worktree('C:/new')]);
	const child = await groups[0].getSplattedChild();
	child.refresh();
	assert.equal((await child.getChildren()).length, 2);
	await node.refresh(true);
	assert.equal((await (await node.getChildren())[0].getChildren()).length, 2);
});

test('a failed repository does not hide an unrelated successful repository', async () => {
	const repos = [repository('C:/failed'), repository('C:/ok')];
	const { node } = loadView(repos, new Map([[repos[0].path, new Error('lookup failed')], [repos[1].path, [worktree(repos[1].path, true)]]]));
	const groups = await node.getChildren();
	assert.equal(groups.length, 2);
	assert.match((await groups[0].getChildren())[0].message, /lookup failed/);
	assert.equal((await groups[1].getChildren())[0].worktree.path, 'C:/ok');
});

test('only unrelated Git repositories have separate group headers even when names match', async () => {
	const repos = [repository('C:/one/repo'), repository('C:/two/repo')];
	const { node } = loadView(repos, new Map(repos.map(repo => [repo.path, [worktree(repo.path, true)]])));
	const groups = await node.getChildren();
	assert.equal(groups.length, 2);
	assert.deepEqual(groups.map(group => group.repo.path), repos.map(repo => repo.path));
	assert.equal(await node.getSplattedChild(), undefined);
});

test('opening a linked worktree marks it current while retaining the distinct main worktree', async () => {
	const repo = repository('C:/linked');
	const family = [worktree('C:/repo', true), worktree(repo.path)];
	const { node } = loadView([repo], new Map([[repo.path, family]]));
	const rows = await node.getChildren();
	const items = await Promise.all(rows.map(row => row.getTreeItem()));
	assert.match(String(items[0].description), /主工作树/);
	assert.doesNotMatch(String(items[0].description), /当前工作树/);
	assert.equal(items[1].description, 'main · 当前工作树');
	assert.match(String(items[1].tooltip), /当前窗口|此窗口/);
});

test('grouping keeps change subscriptions for every open worktree and disposes them on reset', async () => {
	const repos = [repository('C:/repo'), repository('C:/linked')];
	const family = [worktree('C:/repo', true), worktree('C:/linked')];
	const { node, changes } = loadView(repos, new Map(repos.map(repo => [repo.path, family])));
	const rows = await node.getChildren();
	for (const row of rows) await row.getChildren();
	assert.ok(repos.every(repo => repo.subscriptions > 0));
	repos[1].emit('Heads');
	await new Promise(resolve => setImmediate(resolve));
	assert.ok(changes.length > 0);
	await node.refresh(true);
	await new Promise(resolve => setImmediate(resolve));
	assert.ok(repos.every(repo => repo.subscriptions === 0));
});

test('empty workspace remains empty and a failed worktree query stays visible', async () => {
	const empty = loadView([], new Map());
	assert.deepEqual(await empty.node.getChildren(), []);
	assert.match(empty.view.message, /找不到仓库/);
	const repo = repository('C:/repo');
	const failed = loadView([repo], new Map([[repo.path, new Error('worktree lookup failed')]]));
	const rows = await failed.node.getChildren();
	assert.match(rows[0].message, /worktree lookup failed/);
});
