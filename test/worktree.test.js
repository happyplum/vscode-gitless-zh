const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadParser() {
	const source = fs.readFileSync(path.join(root, 'src/git/parsers/worktreeParser.ts'), 'utf8');
	const code = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
	}).outputText;
	const module = { exports: {} };
	new Function('module', 'exports', code)(module, module.exports);
	return module.exports;
}

function loadCheckout(dependencies) {
	const fileName = 'src/git/gitService.ts';
	const source = fs.readFileSync(path.join(root, fileName), 'utf8');
	const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
	const declaration = file.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'GitService');
	const member = declaration.members.find(node => node.body && node.name?.getText(file) === 'checkout');
	const code = ts.transpileModule(`class Subject { ${member.getText(file)} } module.exports = Subject;`, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2019,
			experimentalDecorators: true,
		},
	}).outputText;
	const module = { exports: {} };
	new Function('module', 'log', ...Object.keys(dependencies), code)(
		module, () => () => undefined, ...Object.values(dependencies),
	);
	return module.exports.prototype.checkout;
}

function loadWorktreeGit(runGit) {
	const fileName = 'src/git/git.ts';
	const source = fs.readFileSync(path.join(root, fileName), 'utf8');
	const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
	const namespace = file.statements.find(node => ts.isModuleDeclaration(node) && node.name.text === 'Git');
	const names = ['worktree__list', 'worktree__add', 'worktree__remove', 'worktree__lock', 'worktree__unlock'];
	const declarations = namespace.body.statements.filter(node =>
		ts.isFunctionDeclaration(node) && names.includes(node.name?.text),
	);
	const code = ts.transpileModule(
		`${declarations.map(node => node.getText(file).replace(/^export\s+/, '')).join('\n')}\nmodule.exports = { ${names.join(', ')} };`,
		{ compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } },
	).outputText;
	const module = { exports: {} };
	new Function('module', 'git', code)(module, runGit);
	return module.exports;
}

function loadRepositorySearchCore() {
	const fileName = 'src/git/gitService.ts';
	const source = fs.readFileSync(path.join(root, fileName), 'utf8');
	const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
	const declaration = file.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'GitService');
	const member = declaration.members.find(node => node.name?.getText(file) === 'repositorySearchCore');
	const code = ts.transpileModule(`class Subject { ${member.getText(file)} } module.exports = Subject;`, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true },
	}).outputText;
	const module = { exports: {} };
	const Logger = { getCorrelationContext: () => undefined, error: () => undefined };
	new Function('module', 'fs', 'paths', 'Logger', 'debug', code)(module, fs, path, Logger, () => (_target, _key, descriptor) => descriptor);
	return module.exports;
}

function loadOpenWorktree(dependencies) {
	const fileName = 'src/commands/common.ts';
	const source = fs.readFileSync(path.join(root, fileName), 'utf8');
	const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
	const declaration = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'openWorktree');
	const code = ts.transpileModule(
		`${declaration.getText(file).replace(/^export\s+/, '')}\nmodule.exports = openWorktree;`,
		{ compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } },
	).outputText;
	const module = { exports: {} };
	new Function('module', ...Object.keys(dependencies), code)(module, ...Object.values(dependencies));
	return module.exports;
}

function loadRepositorySwitchCore(dependencies) {
	const fileName = 'src/git/models/repository.ts';
	const source = fs.readFileSync(path.join(root, fileName), 'utf8');
	const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
	const declaration = file.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'Repository');
	const member = declaration.members.find(node => node.name?.getText(file) === 'switchCore');
	const code = ts.transpileModule(`class Subject { ${member.getText(file)} } module.exports = Subject;`, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
	}).outputText;
	const module = { exports: {} };
	new Function('module', ...Object.keys(dependencies), code)(module, ...Object.values(dependencies));
	return module.exports;
}

test('worktree porcelain parser preserves full refs, unusual paths, and flags', () => {
	const { parseWorktrees } = loadParser();
	const output = [
		'worktree C:/repo', 'HEAD 1111111111111111111111111111111111111111', 'branch refs/heads/main', '',
		'worktree C:/repo/.worktrees/中文 path\nline', 'HEAD 2222222222222222222222222222222222222222',
		'branch refs/heads/fix/native-git-hooks-review', 'locked paused\nfor review', '',
		'worktree C:/repo/.worktrees/gone', 'HEAD 3333333333333333333333333333333333333333',
		'detached', 'prunable gitdir missing', '',
	].join('\0');
	assert.deepEqual(parseWorktrees(output), [
		{ path: 'C:/repo', head: '1111111111111111111111111111111111111111', branch: 'refs/heads/main', main: true, bare: false, detached: false, locked: undefined, prunable: undefined },
		{ path: 'C:/repo/.worktrees/中文 path\nline', head: '2222222222222222222222222222222222222222', branch: 'refs/heads/fix/native-git-hooks-review', main: false, bare: false, detached: false, locked: 'paused\nfor review', prunable: undefined },
		{ path: 'C:/repo/.worktrees/gone', head: '3333333333333333333333333333333333333333', branch: undefined, main: false, bare: false, detached: true, locked: undefined, prunable: 'gitdir missing' },
	]);
});

test('checkout reports an occupied branch from the Git worktree list', async () => {
	const messages = [];
	const worktree = { path: 'F:/b/tnyma-3.0/.worktrees/native-git-hooks-review', branch: 'refs/heads/fix/native-git-hooks-review' };
	const checkout = loadCheckout({
		Git: { checkout: async () => { throw new Error("fatal: 'fix/native-git-hooks-review' is already used by worktree at 'F:/old-path'"); } },
		Logger: { getCorrelationContext: () => undefined, error: error => messages.push(error) },
		Messages: { showGenericErrorMessage: message => messages.push(message) },
		emptyStr: '',
	});
	let queries = 0;
	const result = await checkout.call({ getWorktrees: async () => { queries++; return [worktree]; } }, 'F:/b/tnyma-3.0', 'fix/native-git-hooks-review', { createBranch: undefined });
	assert.deepEqual(result, { status: 'occupied', worktree });
	assert.equal(queries, 1);
	assert.deepEqual(messages, []);
});

test('file restore does not trigger worktree occupancy lookup', async () => {
	const messages = [];
	const checkout = loadCheckout({
		Git: { checkout: async () => { throw new Error("fatal: 'topic' is already used by worktree at 'F:/other'"); } },
		Logger: { getCorrelationContext: () => undefined, error: error => messages.push(error) },
		Messages: { showGenericErrorMessage: message => messages.push(message) },
		emptyStr: '',
	});
	const result = await checkout.call({ getWorktrees: async () => { throw new Error('file restore must not look up worktrees'); } }, 'F:/repo', 'topic', { fileName: 'file.txt' });
	assert.deepEqual(result, { status: 'failed' });
	assert.equal(messages.length, 2);
});

test('occupied branch offers current and new window, then associates the selected worktree', async () => {
	const calls = [];
	const path = 'F:/b/tnyma-3.0/.worktrees/native-git-hooks-review';
	const open = loadOpenWorktree({
		window: {
			showWarningMessage: async (message, options, ...buttons) => {
				calls.push(['warning', message, options, buttons]);
				return '在新窗口打开';
			},
		},
		Container: { git: { getRepoPath: async (requestedPath, options) => {
			calls.push(['associate', requestedPath, options]);
			return requestedPath;
		} } },
		GitService: { openBuiltInGitRepository: async requestedPath => calls.push(['builtInGit', requestedPath]) },
		Uri: { file: value => value },
		OpenWorkspaceLocation: { CurrentWindow: 'currentWindow', NewWindow: 'newWindow', AddToWorkspace: 'addToWorkspace' },
		openWorkspace: (uri, options) => calls.push(['openFolder', uri, options]),
	});
	assert.equal(await open(path, { branch: 'fix/native-git-hooks-review' }), true);
	assert.match(calls[0][1], /fix\/native-git-hooks-review/);
	assert.equal(calls[0][2].modal, true);
	assert.deepEqual(calls[0][3], ['在当前窗口打开', '在新窗口打开']);
	assert.deepEqual(calls.slice(1), [
		['associate', path, { isDirectory: true }],
		['builtInGit', path],
		['openFolder', path, { location: 'newWindow' }],
	]);
});

test('repository switch only signals a change after checkout succeeds', async () => {
	const calls = [];
	let result = { status: 'occupied', worktree: { path: 'F:/other' } };
	const Subject = loadRepositorySwitchCore({
		Container: { git: { checkout: async () => result } },
		RepositoryChange: { Unknown: 'unknown' },
		openWorktree: async (path, options) => { calls.push(['open', path, options]); return false; },
		Logger: { error: () => assert.fail('unexpected error') },
		Messages: { showGenericErrorMessage: () => assert.fail('unexpected message') },
	});
	const repo = new Subject();
	repo.path = 'F:/main';
	repo.fireChange = change => calls.push(['changed', change]);
	assert.equal(await repo.switchCore('feature'), 'occupied');
	assert.deepEqual(calls, [['open', 'F:/other', { branch: 'feature' }]]);
	result = { status: 'switched' };
	assert.equal(await repo.switchCore('feature'), 'switched');
	assert.deepEqual(calls[1], ['changed', 'unknown']);
});

test('Git worktree commands list, lock, unlock, and remove a linked worktree safely', async () => {
	const parent = path.join(root, '.tmp');
	const parentExisted = fs.existsSync(parent);
	fs.mkdirSync(parent, { recursive: true });
	const fixture = fs.mkdtempSync(path.join(parent, 'worktree-test-'));
	assert.equal(path.dirname(fixture), parent);
	const repo = path.join(fixture, 'repo');
	const linked = path.join(fixture, '中文 linked worktree');
	const git = (cwd, ...args) => execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, GIT_AUTHOR_NAME: 'Worktree Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Worktree Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
	});
	const worktreeGit = loadWorktreeGit(async (options, ...args) => git(options.cwd, ...args));
	try {
		fs.mkdirSync(repo);
		git(repo, 'init', '-b', 'main');
		fs.writeFileSync(path.join(repo, 'tracked.txt'), 'content');
		git(repo, 'add', 'tracked.txt');
		git(repo, 'commit', '-m', 'fixture');

		await worktreeGit.worktree__add(repo, linked, 'main', 'feature');
		let worktrees = loadParser().parseWorktrees(await worktreeGit.worktree__list(repo));
		assert.equal(worktrees.length, 2);
		assert.equal(worktrees[0].main, true);
		assert.equal(worktrees[1].branch, 'refs/heads/feature');
		assert.equal(path.normalize(worktrees[1].path), path.normalize(linked));
		assert.equal(path.normalize(git(linked, 'rev-parse', '--show-toplevel').trim()), path.normalize(linked));
		const found = await new (loadRepositorySearchCore())().repositorySearchCore(fixture, 2, {});
		assert.deepEqual(new Set(found.map(p => path.normalize(p))), new Set([path.join(repo, '.git'), path.join(linked, '.git')]));
		assert.throws(() => git(repo, 'checkout', 'feature', '--'), /already used by worktree at/);

		await worktreeGit.worktree__lock(repo, linked, 'review');
		worktrees = loadParser().parseWorktrees(await worktreeGit.worktree__list(repo));
		assert.equal(worktrees[1].locked, 'review');
		await assert.rejects(worktreeGit.worktree__remove(repo, linked));
		await worktreeGit.worktree__unlock(repo, linked);

		fs.writeFileSync(path.join(linked, 'untracked.txt'), 'keep');
		await assert.rejects(worktreeGit.worktree__remove(repo, linked));
		fs.unlinkSync(path.join(linked, 'untracked.txt'));
		await worktreeGit.worktree__remove(repo, linked);
		assert.equal(fs.existsSync(linked), false);
		assert.match(git(repo, 'branch', '--list', 'feature'), /feature/);
	} finally {
		assert.equal(path.dirname(fixture), parent);
		fs.rmSync(fixture, { recursive: true, force: true });
		if (!parentExisted) fs.rmdirSync(parent);
	}
});
