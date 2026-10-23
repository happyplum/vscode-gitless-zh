const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadWorktreeNode(getLog) {
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
		constructor(_view, _parent, commit) {
			this.commit = commit;
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
			TreeItem,
			TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
			window: { withProgress: (_options, action) => action() },
		},
		'../../commands/common': { Commands: { WorktreeOpen: 'gitlens.worktreeOpen' } },
		'../../container': { Container: { git: { getLog } } },
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

test('the existing repositories view keeps click-to-open for worktrees', () => {
	const WorktreeNode = loadWorktreeNode(() => assert.fail('must not query commits on click'));
	const node = new WorktreeNode(makeView('gitlens.views.repositories'), {}, { path: 'C:/main' }, {
		path: 'C:/linked', head: 'a'.repeat(40), branch: 'refs/heads/feature', main: false,
	});
	const item = node.getTreeItem();
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
	const item = node.getTreeItem();
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
