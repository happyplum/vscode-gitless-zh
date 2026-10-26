const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadWorktreeNode(getLog, git = {}) {
	const source = fs.readFileSync(path.join(root, 'src/views/nodes/worktreeNode.ts'), 'utf8');
	const code = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
	}).outputText;
	class TreeItem {
		constructor(label, collapsibleState) {
			this.label = label;
			this.collapsibleState = collapsibleState;
		}
	}
	class CommitNode {
		constructor(_view, _parent, commit, unpublished, branch, getBranchAndTagTips) {
			this.commit = commit;
			this.unpublished = unpublished;
			this.branch = branch;
			this.getBranchAndTagTips = getBranchAndTagTips;
		}
	}
	class MessageNode {
		constructor(_view, _parent, message) {
			this.message = message;
		}
	}
	const dependencies = {
		path,
		vscode: {
			ThemeIcon: class { constructor(id) { this.id = id; } },
			Uri: { parse: value => value },
			TreeItem,
			TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
			window: { withProgress: (_options, action) => action() },
		},
		'../../commands/common': { Commands: { WorktreeOpen: 'gitlens.worktreeOpen' } },
		'../../container': { Container: { git: {
			getLog,
			getBranch: async () => undefined,
			getBranches: async () => [],
			getStatusForRepo: async () => undefined,
			getBranchesAndTagsTipsFn: async () => () => undefined,
			getBranchAheadRange: async () => undefined,
			...git,
		} } },
		'../../git/gitUri': { GitUri: { fromRepoPath: repoPath => ({ repoPath }) } },
		'./viewNode': {
			ViewNode: class { constructor(uri, view, parent) { this.uri = uri; this.view = view; this.parent = parent; } },
			ContextValues: { Worktree: 'gitlens:worktree' },
		},
		'./commitNode': { CommitNode },
		'./common': { MessageNode, LoadMoreNode: class {} },
		'./helpers': { insertDateMarkers: nodes => Array.from(nodes) },
	};
	const module = { exports: {} };
	new Function('require', 'module', 'exports', code)(
		name => {
			if (Object.hasOwn(dependencies, name)) return dependencies[name];
			throw new Error(`Unexpected dependency ${name}`);
		},
		module,
		module.exports,
	);
	return module.exports.WorktreeNode;
}

function makeView(id = 'gitlens.views.worktrees') {
	return {
		id,
		config: { defaultItemLimit: 20, pageItemLimit: 20 },
		getNodeLastKnownLimit: () => undefined,
	};
}

test('the existing repositories view keeps click-to-open for worktrees', async () => {
	const WorktreeNode = loadWorktreeNode(() => assert.fail('must not query commits on click'));
	const node = new WorktreeNode(makeView('gitlens.views.repositories'), {}, { path: 'C:/main' }, {
		path: 'C:/linked', head: 'a'.repeat(40), branch: 'refs/heads/feature', main: false,
	});
	const item = await node.getTreeItem();
	assert.equal(item.collapsibleState, 0);
	assert.equal(item.command.command, 'gitlens.worktreeOpen');
	assert.deepEqual(item.command.arguments, [node]);
});

test('clicking a worktree expands commits from that worktree HEAD', async () => {
	const head = 'a'.repeat(40);
	const seen = [];
	const WorktreeNode = loadWorktreeNode(async (repoPath, options) => {
		seen.push({ repoPath, options });
		return { commits: new Map([[head, { ref: head, message: 'linked worktree commit' }]]), hasMore: false };
	});
	const node = new WorktreeNode(makeView(), {}, { path: 'C:/main' }, {
		path: 'C:/linked', head, branch: 'refs/heads/feature', main: false,
	});
	const item = await node.getTreeItem();
	assert.equal(item.collapsibleState, 1);
	assert.equal(item.command, undefined);
	const children = await node.getChildren();
	assert.deepEqual(seen, [{ repoPath: 'C:/main', options: { ref: head, limit: 20 } }]);
	assert.equal(children[0].commit.ref, head);
});

test('worktree without a HEAD never shows the parent repository history', async () => {
	const WorktreeNode = loadWorktreeNode(() => assert.fail('must not query the parent HEAD'));
	const node = new WorktreeNode(makeView(), {}, { path: 'C:/main' }, {
		path: 'C:/empty', head: undefined, main: false,
	});
	const children = await node.getChildren();
	assert.match(children[0].message, /提交/);
});

function trackedBranch(overrides = {}) {
	return {
		name: 'feature', ref: 'feature', repoPath: 'C:/main', current: false,
		state: { ahead: 3, behind: 1 }, upstream: { name: 'origin/feature', missing: false },
		getTrackingStatus: options => options?.expand ? '落后 1 个提交，领先 3 个提交' : '1↓ 3↑',
		getStatus: async () => 'diverged',
		...overrides,
	};
}

function statusNode(git = {}, worktree = {}) {
	const branch = trackedBranch();
	const WorktreeNode = loadWorktreeNode(async () => undefined, {
		getBranch: async () => branch,
		getBranches: async (_path, options) => [branch].filter(options?.filter ?? (() => true)),
		...git,
	});
	return new WorktreeNode(makeView(), {}, { path: 'C:/main' }, {
		path: 'C:/linked', head: 'a'.repeat(40), branch: 'refs/heads/feature', main: false,
		...worktree,
	});
}

test('worktree summary uses shared tracking counts and counts each changed file once in its own directory', async () => {
	const paths = [];
	const node = statusNode({
		getBranch: async repoPath => { assert.equal(repoPath, 'C:/linked'); return trackedBranch(); },
		getStatusForRepo: async repoPath => {
			paths.push(repoPath);
			return { files: [{ indexStatus: 'M', workingTreeStatus: 'M' }, { workingTreeStatus: '?' }] };
		},
	});
	const item = await node.getTreeItem();
	assert.deepEqual(paths, ['C:/linked']);
	assert.match(item.description, /1↓ 3↑/);
	assert.match(item.description, /2 个文件/);
	assert.match(item.description, /feature/);
	assert.ok(item.description.indexOf('2 个文件') < item.description.indexOf('feature'));
	assert.match(String(item.tooltip), /origin\/feature/);
	assert.match(String(item.tooltip), /领先 3 个提交/);
	assert.equal(item.resourceUri, 'gitlens-view://branch/status/diverged');
});

test('clean synchronized worktree keeps the row quiet and explains its state in the tooltip', async () => {
	const branch = trackedBranch({
		state: { ahead: 0, behind: 0 }, getTrackingStatus: () => '', getStatus: async () => 'upToDate',
	});
	const node = statusNode({
		getBranch: async () => branch, getBranches: async () => [branch],
		getStatusForRepo: async () => ({ files: [] }),
	});
	const item = await node.getTreeItem();
	assert.doesNotMatch(item.description, /0[↑↓]|0 个文件/);
	assert.match(String(item.tooltip), /同步/);
	assert.match(String(item.tooltip), /干净|无未提交/);
});

test('unconfigured and missing upstreams are distinct from synchronized branches', async () => {
	for (const [upstream, expected] of [[undefined, /未设置上游|未发布/], [{ name: 'origin/gone', missing: true }, /上游.*(?:丢失|缺失)/]]) {
		const branch = trackedBranch({ upstream, state: { ahead: 0, behind: 0 }, getTrackingStatus: () => '', getStatus: async () => upstream ? 'missingUpstream' : 'unpublished' });
		const item = await statusNode({ getBranch: async () => branch, getBranches: async () => [branch] }).getTreeItem();
		assert.match(String(item.tooltip), expected);
		assert.doesNotMatch(String(item.tooltip), /已.*同步/);
	}
});

test('worktree commits reuse unpublished markers and branch/tag tips, including after pagination', async () => {
	const head = 'a'.repeat(40);
	const base = 'b'.repeat(40);
	const branch = trackedBranch();
	const tip = sha => sha === base ? 'origin/main' : undefined;
	const secondLog = { commits: new Map([[head, { ref: head }], [base, { ref: base }]]), count: 2, hasMore: false };
	const WorktreeNode = loadWorktreeNode(async () => ({
		commits: new Map([[head, { ref: head }]]), hasMore: true, more: async () => secondLog,
	}), {
		getBranch: async () => branch, getBranches: async () => [branch],
		getBranchesAndTagsTipsFn: async (repoPath, currentName) => {
			assert.equal(repoPath, 'C:/main');
			assert.equal(currentName, 'feature');
			return tip;
		},
		getBranchAheadRange: async received => { assert.equal(received.name, 'feature'); return 'origin/feature..feature'; },
		getLogRefsOnly: async (_repoPath, options) => { assert.equal(options.ref, 'origin/feature..feature'); return new Set([head]); },
	});
	const node = new WorktreeNode(makeView(), {}, { path: 'C:/main' }, { path: 'C:/linked', head, branch: 'refs/heads/feature' });
	let children = await node.getChildren();
	assert.equal(children[0].unpublished, true);
	assert.equal(children[0].branch, undefined, 'decorations must not enable current-branch actions against the parent repository');
	assert.equal(children[0].getBranchAndTagTips, tip);
	node.triggerChange = () => {};
	await node.loadMore();
	children = await node.getChildren();
	assert.equal(children[0].unpublished, true);
	assert.equal(children[1].unpublished, false);
	assert.equal(children[1].getBranchAndTagTips(base), 'origin/main');
});

test('bare and prunable worktrees never read a working directory status', async () => {
	for (const worktree of [{ bare: true }, { prunable: 'gitdir missing' }]) {
		await statusNode({ getStatusForRepo: () => assert.fail('invalid working directory') }, worktree).getTreeItem();
	}
});

test('refresh reads changed file counts again instead of preserving an old clean status', async () => {
	let files = [];
	const node = statusNode({ getStatusForRepo: async () => ({ files }) });
	assert.doesNotMatch((await node.getTreeItem()).description, /个文件/);
	files = [{ workingTreeStatus: '?' }];
	node.refresh(true);
	assert.match((await node.getTreeItem()).description, /1 个文件/);
});

test('detached worktree keeps file counts without inventing upstream tracking', async () => {
	const branch = trackedBranch({ detached: true });
	const node = statusNode({
		getBranch: async () => branch,
		getStatusForRepo: async () => ({ files: [{}] }),
	}, { detached: true, branch: undefined, locked: 'keep', main: true });
	const item = await node.getTreeItem();
	assert.match(item.description, /1 个文件/);
	assert.match(item.description, /分离 HEAD.*主工作树.*已锁定/);
	assert.doesNotMatch(item.description, /[↑↓]/);
	assert.doesNotMatch(String(item.tooltip), /同步|origin/);
	assert.equal(item.resourceUri, undefined);
	assert.equal(item.iconPath.id, 'lock');
});

test('an unreadable worktree status preserves navigation and never claims a clean worktree', async () => {
	const node = statusNode({ getStatusForRepo: async () => { throw new Error('directory removed'); } });
	const item = await node.getTreeItem();
	assert.equal(item.label, 'linked');
	assert.match(String(item.tooltip), /状态不可用/);
	assert.doesNotMatch(String(item.tooltip), /工作区干净|0 个文件/);
});

test('explicit worktree refresh resets shared Git caches before rebuilding the tree', async () => {
	const source = fs.readFileSync(path.join(root, 'src/views/worktreesView.ts'), 'utf8');
	const code = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
	}).outputText;
	const calls = [];
	let refresh;
	let resetDone;
	const reset = new Promise(resolve => { resetDone = resolve; });
	const dependencies = {
		vscode: { commands: { registerCommand: (_id, callback) => { refresh = callback; } } },
		'../container': { Container: { git: {
			resetCaches: async (...args) => { calls.push(args); await reset; },
			onDidChangeRepositories: () => {},
		} } },
		'./viewBase': { ViewBase: class {} },
		'../git/git': {}, '../git/gitUri': {},
		'./nodes/viewNode': { RepositoryFolderNode: class {}, ViewNode: class {} },
		'./nodes/worktreesNode': {},
	};
	const module = { exports: {} };
	new Function('require', 'module', 'exports', code)(name => {
		assert.ok(Object.hasOwn(dependencies, name), name);
		return dependencies[name];
	}, module, module.exports);
	module.exports.WorktreesView.prototype.registerCommands.call({
		getQualifiedCommand: name => name,
		refresh: reset => calls.push(['refresh', reset]),
	});
	const pending = refresh();
	assert.deepEqual(calls, [['branches', 'tags', 'status']]);
	resetDone();
	await pending;
	assert.deepEqual(calls, [['branches', 'tags', 'status'], ['refresh', true]]);
});

test('the dedicated view and worktree context menu expose navigation separately', () => {
	const views = JSON.parse(fs.readFileSync(path.join(root, 'manifest/views.json'), 'utf8'));
	const menus = JSON.parse(fs.readFileSync(path.join(root, 'manifest/menus.json'), 'utf8'));
	assert.ok(views.scm.some(view => view.id === 'gitlens.views.worktrees'));
	assert.ok(menus['view/item/context'].some(item =>
		item.command === 'gitlens.worktreeOpen' &&
		item.when.includes('gitlens:worktree') &&
		!item.group.startsWith('inline'),
	));
});
