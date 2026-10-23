// Run with: node test/upstream.test.js
// Load the production TypeScript with isolated extension-host dependencies.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const cache = new Map();
const container = { git: { getRemotes: async () => [] } };
const decorator = () => () => undefined;
const memoize = () => (_target, _key, descriptor) => {
	if (descriptor.value == null) return descriptor;
	const original = descriptor.value;
	const values = new WeakMap();
	descriptor.value = function (...args) {
		if (!values.has(this)) values.set(this, original.apply(this, args));
		return values.get(this);
	};
	return descriptor;
};
function load(relative) {
	const file = path.resolve(__dirname, '..', relative);
	if (cache.has(file)) return cache.get(file).exports;
	const module = { exports: {} };
	cache.set(file, module);
	const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2019,
			experimentalDecorators: true,
		},
	}).outputText;
	const localRequire = name => {
		if (name.endsWith('/system')) return { debug: decorator, memoize };
		if (name.endsWith('/container')) return { Container: container };
		if (name.endsWith('/configuration')) return { BranchSorting: {}, DateStyle: {} };
		if (name.endsWith('/constants')) return {};
		if (name === './status') return { GitStatus: {} };
		if (name === '../git' || name === './models') return {};
		if (name === '../models/branch') return load('src/git/models/branch.ts');
		if (name === './branch') return load('src/git/models/branch.ts');
		if (file.endsWith('models.ts') && name.startsWith('./')) return {};
		return require(name);
	};
	new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
	return module.exports;
}
const { GitBranchParser } = load('src/git/parsers/branchParser.ts');
const { GitBranch } = load('src/git/models/branch.ts');
const { GitReference } = load('src/git/models/models.ts');
function method(fileName, className, methodName, dependencies) {
	const file = ts.createSourceFile(
		fileName,
		fs.readFileSync(path.resolve(__dirname, '..', fileName), 'utf8'),
		ts.ScriptTarget.Latest,
		true,
	);
	const declaration = file.statements.find(node => ts.isClassDeclaration(node) && node.name.text === className);
	const member = declaration.members.find(node => node.body && node.name && node.name.getText(file) === methodName);
	const code = ts.transpileModule(`class Subject { ${member.getText(file)} } module.exports = Subject;`, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2019,
			experimentalDecorators: true,
		},
	}).outputText;
	const module = { exports: {} };
	new Function('module', 'gate', 'log', 'debug', ...Object.keys(dependencies), code)(
		module,
		decorator,
		decorator,
		decorator,
		...Object.values(dependencies),
	);
	return module.exports.prototype[methodName];
}
const calls = [];
const remoteResourceType = { Comparison: 'comparison', CreatePullRequest: 'createPullRequest', File: 'file', Revision: 'revision' };
const remoteProviderExecute = method('src/quickpicks/remoteProviderPicker.ts', 'CopyOrOpenRemoteCommandQuickPickItem', 'execute', {
	GitBranch, Container: container, RemoteResourceType: remoteResourceType,
});
const statusRemote = method('src/git/models/status.ts', 'GitStatus', 'getRemote', { Container: container });
const getRemotes = method('src/git/gitService.ts', 'GitService', 'getRemotes', {});
const gitReference = { isBranch: reference => reference?.refType === 'branch' };
const pullConfirm = method('src/commands/git/pull.ts', 'PullGitCommand', 'confirmStep', {
	GitReference: { ...gitReference, toString: reference => reference.name },
	appendReposToTitle: () => 'pull',
	FlagsQuickPickItem: { create: (_flags, item, details) => ({ item, ...details }) },
	DirectiveQuickPickItem: { create: (_directive, _picked, details) => details },
	Directive: { Cancel: 'cancel' },
});
class BranchNode {}
class BranchTrackingStatusNode {}
const rebaseToUpstream = method('src/views/viewCommands.ts', 'ViewCommands', 'rebaseToRemote', {
	BranchNode, BranchTrackingStatusNode,
	GitReference: { create: (ref, repoPath, details) => ({ ref, repoPath, ...details }) },
	GitActions: { rebase: async (_repoPath, reference) => calls.push(reference) },
});
const fetch = method('src/git/gitService.ts', 'GitService', 'fetch', {
	GitReference: gitReference,
	Git: { fetch: async (...args) => calls.push(['fetch', ...args]) },
});
const fetchRepository = method('src/git/models/repository.ts', 'Repository', 'fetchCore', {
	Container: { git: { fetch: async (repoPath, options) => fetch.call({ getRepository: async () => repository(makeBranch({ name: 'release/2.0', missing: false, local: true })) }, repoPath, options) } },
	RepositoryChange: { Unknown: 'unknown' }, Logger: { error() {} }, Messages: { showGenericErrorMessage: () => calls.push('error') },
});
let conflictPromptChoice;
let conflictRetryFails = false;
const conflictCalls = [];
const applyChangesToWorkingFile = method('src/git/gitService.ts', 'GitService', 'applyChangesToWorkingFile', {
	Git: {
		diff: async () => 'patch',
		apply: async (_repoPath, _patch, options) => {
			conflictCalls.push(['apply', options]);
			if (options == null) throw new Error('patch does not apply');
			if (conflictRetryFails) throw new Error('retry failed');
		},
	},
	Logger: { getCorrelationContext: () => undefined, error: error => conflictCalls.push(['error', error.message]) },
	Messages: { showGenericErrorMessage: message => conflictCalls.push(['message', message]) },
	window: { showWarningMessage: async (...args) => {
		conflictCalls.push(['prompt', args]);
		return args[conflictPromptChoice];
	} },
	emptyStr: '',
});
const push = method('src/git/models/repository.ts', 'Repository', 'pushCore', {
	GitReference: gitReference,
	GitService: {
		getOrOpenBuiltInGitRepository: async () => ({ push: async (...args) => calls.push(['push', ...args]) }),
	},
	commands: { executeCommand: async (...args) => calls.push(['command', ...args]) },
	BuiltInGitCommands: { Push: 'push', PushForce: 'pushForce' },
	RepositoryChange: { Unknown: 'unknown' },
	Logger: {
		error: error => {
			throw error;
		},
	},
	Messages: {},
});
const branchDelete = method('src/git/models/repository.ts', 'Repository', 'branchDelete', {
	Arrays: { groupByMap: (items, key) => {
		const groups = new Map();
		for (const item of items) { const name = key(item); if (!groups.has(name)) groups.set(name, []); groups.get(name).push(item); }
		return groups;
	} },
	runGitCommandInNewTerminal: (args, cwd) => calls.push([args, cwd]),
	setTimeout: () => undefined,
});
const makeBranch = upstream => new GitBranch('/repo', 'topic', false, true, undefined, 'abc', upstream);
const repository = branch => ({
	path: '/repo',
	getBranch: async () => branch,
	fireChange() {},
	showCreatePullRequestPrompt() {},
});
function pullRequestRunner() {
	const fileName = 'src/extension.ts';
	const file = ts.createSourceFile(fileName, fs.readFileSync(path.resolve(__dirname, '..', fileName), 'utf8'), ts.ScriptTarget.Latest, true);
	const declaration = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'registerBuiltInActionRunners');
	const code = ts.transpileModule(declaration.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2019 } }).outputText;
	let runner;
	const mockContainer = {
		git: { getBranches: async () => [{ getTrackingWithoutRemote: () => 'release/2.0' }] },
		actionRunners: { registerBuiltIn: (name, action) => { if (name === 'createPullRequest') runner = action; return {}; } },
	};
	new Function('Container', 'GitBranch', 'executeCommand', 'Commands', `${code}; return registerBuiltInActionRunners;`)(
		mockContainer, GitBranch, async (_command, args) => calls.push(args), { CreatePullRequestOnRemote: 'createPullRequest' },
	)({ subscriptions: [] });
	return runner;
}
function remoteFilePick(pick, remotes) {
	const file = ts.createSourceFile('openFileOnRemote.ts', fs.readFileSync(path.resolve(__dirname, '../src/commands/openFileOnRemote.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
	let block;
	function visit(node) {
		if (ts.isIfStatement(node) && node.expression.getText(file) === 'pick.remote') block = node.thenStatement;
		ts.forEachChild(node, visit);
	}
	visit(file);
	const code = ts.transpileModule(`function resolve(pick, remotes) { const args = {}; ${block.getText(file)} return { args, remotes }; }`, { compilerOptions: { target: ts.ScriptTarget.ES2019 } }).outputText;
	return new Function('GitBranch', 'GitReference', `${code}; return resolve;`)(GitBranch, GitReference)(pick, remotes);
}
function viewMethod(fileName, className, name, branch) {
	const nodes = {};
	for (const node of ['RemotesViewNode', 'RemotesRepositoryNode', 'BranchOrTagFolderNode', 'RemoteNode', 'BranchNode', 'RemotesNode', 'RepositoriesNode', 'BranchesNode']) nodes[node] = class {};
	nodes.RepositoryNode = class { static getId() { return '/repo'; } };
	const remote = Object.assign(new nodes.RemoteNode(), { id: '/repo:remote', remote: { name: 'team/origin' } });
	const invoke = method(fileName, className, name, {
		...nodes, GitBranch,
		Container: { git: {
			getCommitBranches: async (_path, _ref, options) => options?.remotes ? [branch.name] : [],
			getBranches: async () => [branch],
		} },
	});
	return { invoke, instance: { findNode: (_predicate, options) => options.canTraverse(remote) } };
}
const row = (upstream, tracking = '') =>
	`<h>*<n>refs/heads/topic<u>${upstream}<t>${tracking}<r>abc<d>2026-10-21 00:00:00 +0000`;
const cases = [
	[
		'local upstream full ref preserves slash and has no remote',
		() => {
			const [branch] = GitBranchParser.parse(row('refs/heads/origin/topic'), '/repo');
			assert.equal(branch.upstream.name, 'origin/topic');
			assert.equal(branch.upstream.local, true);
			assert.equal(branch.getRemoteName(), undefined);
			assert.equal(branch.getTrackingWithoutRemote(), 'origin/topic');
		},
	],
	[
		'configured remote wins over ambiguous short upstream',
		() => {
			const [branch] = GitBranchParser.parse(
				row('refs/remotes/team/origin/topic'),
				'/repo',
				'branch.topic.remote team/origin\nbranch.topic.merge refs/heads/topic',
			);
			assert.equal(branch.getRemoteName(), 'team/origin');
			assert.equal(branch.getTrackingWithoutRemote(), 'topic');
		},
	],
	[
		'dot remote is local even when upstream name resembles remote',
		() => {
			const [branch] = GitBranchParser.parse(
				row('refs/heads/origin/topic'),
				'/repo',
				'branch.topic.remote .\nbranch.topic.merge refs/heads/origin/topic',
			);
			assert.equal(branch.getRemoteName(), undefined);
			assert.equal(branch.upstream.local, true);
		},
	],
	[
		'gone upstream retains configured remote and branch',
		() => {
			const [branch] = GitBranchParser.parse(
				row('', '[gone]'),
				'/repo',
				'branch.topic.remote origin\nbranch.topic.merge refs/heads/topic',
			);
			assert.equal(branch.upstream.missing, true);
			assert.equal(branch.getRemoteName(), 'origin');
			assert.equal(branch.getTrackingWithoutRemote(), 'topic');
		},
	],
	[
		'unknown upstream does not guess a remote from its prefix',
		() => {
			const [branch] = GitBranchParser.parse(row('refs/remotes/origin/topic'), '/repo');
			assert.equal(branch.getRemoteName(), undefined);
		},
	],
	[
		'remote membership is checked again after removal',
		async () => {
			const branch = new GitBranch('/repo', 'topic', false, true, undefined, 'abc', {
				name: 'origin/topic',
				missing: false,
				local: false,
				remote: 'origin',
				remoteBranch: 'topic',
			});
			container.git.getRemotes = async () => [{ name: 'origin' }];
			assert.equal((await branch.getRemote()).name, 'origin');
			container.git.getRemotes = async () => [];
			assert.equal(await branch.getRemote(), undefined);
		},
	],
	[
		'branch fetch explicitly rejects local, unknown, and removed upstream remotes',
		async () => {
			for (const upstream of [
				{ name: 'origin/topic', missing: false, local: true },
				{ name: 'origin/topic', missing: false },
				{ name: 'origin/topic', missing: false, remote: 'removed', remoteBranch: 'topic' },
			]) {
				calls.length = 0;
				container.git.getRemotes = async () => [{ name: 'origin' }];
				const branch = makeBranch(upstream);
				await assert.rejects(fetch.call({ getRepository: async () => repository(branch) }, '/repo', { branch }));
				assert.deepEqual(calls, []);
			}
		},
	],
	[
		'branch fetch keeps configured remote and full remote branch',
		async () => {
			calls.length = 0;
			container.git.getRemotes = async () => [{ name: 'team/origin' }];
			const branch = makeBranch({
				name: 'team/origin/feature/topic',
				missing: false,
				remote: 'team/origin',
				remoteBranch: 'feature/topic',
			});
			await fetch.call({ getRepository: async () => repository(branch) }, '/repo', { branch });
			assert.equal(calls[0][2].remote, 'team/origin');
			assert.equal(calls[0][2].upstream, 'feature/topic');
		},
	],
	[
		'current branch, other branch, and revision push skip local or unknown upstream',
		async () => {
			for (const upstream of [
				{ name: 'origin/topic', missing: false, local: true },
				{ name: 'origin/topic', missing: false },
				{ name: 'origin/topic', missing: false, remote: 'removed', remoteBranch: 'topic' },
			]) {
				container.git.getRemotes = async () => [{ name: 'origin' }];
				const branch = makeBranch(upstream);
				for (const reference of [
					undefined,
					branch,
					{ refType: 'branch', name: 'other' },
					{ refType: 'revision', ref: 'abc' },
				]) {
					calls.length = 0;
					await push.call(repository(branch), { reference });
					assert.deepEqual(calls, []);
				}
			}
		},
	],
	[
		'explicit publish preserves chosen remote',
		async () => {
			calls.length = 0;
			const branch = makeBranch(undefined);
			await push.call(repository(branch), { reference: branch, publish: { remote: 'origin' } });
			assert.deepEqual(calls, [['push', 'origin', 'topic', true]]);
		},
	],
	['status remote delegates to normalized branch instead of splitting its upstream string', async () => {
		const branch = makeBranch({ name: 'origin/topic', missing: false, local: true });
		container.git.getBranch = async () => branch;
		container.git.getRemotes = async () => [{ name: 'origin' }];
		assert.equal(await statusRemote.call({ repoPath: '/repo', upstream: 'origin/topic' }), undefined);
	}],
	['pull request compare uses the published local branch despite its previous local upstream', async () => {
		calls.length = 0;
		await pullRequestRunner().run({ type: 'createPullRequest', repoPath: '/repo', remote: { name: 'origin' }, branch: { name: 'feature/payments', isRemote: false, upstream: 'release/2.0' } });
		assert.equal(calls[0].compare, 'feature/payments');
	}],
	['pull request compare keeps remote branch prefix removal', async () => {
		calls.length = 0;
		await pullRequestRunner().run({ type: 'createPullRequest', repoPath: '/repo', remote: { name: 'origin' }, branch: { name: 'origin/feature/payments', isRemote: true } });
		assert.equal(calls[0].compare, 'feature/payments');
	}],
	['remote configuration without merge or upstream does not invent a tracking branch', () => {
		const [branch] = GitBranchParser.parse(row(''), '/repo', 'branch.topic.remote origin');
		assert.equal(branch.upstream, undefined);
	}],
	['pull confirmation blocks a noncurrent branch with a local upstream', async () => {
		const branch = new GitBranch('/repo', 'topic', false, false, undefined, 'abc', { name: 'release/2.0', missing: false, local: true });
		const instance = { title: 'pull', createConfirmStep: (_title, items, cancel) => ({ items, cancel }) };
		const generator = pullConfirm.call(instance, { repos: [repository(branch)], reference: branch, flags: [] }, { title: 'pull' });
		const { value: step } = await generator.next();
		assert.deepEqual(step.items, []);
		assert.ok(step.cancel);
	}],
	['rejected branch fetch reports failure without emitting a repository change', async () => {
		calls.length = 0;
		container.git.getRemotes = async () => [{ name: 'origin' }];
		await fetchRepository.call({ path: '/repo', fireChange: () => calls.push('change') }, { branch: { refType: 'branch', name: 'topic' }, pull: true });
		assert.deepEqual(calls, ['error']);
	}],
	['conflict retry prompt is Chinese and accepting it reapplies the patch', async () => {
		conflictCalls.length = 0;
		conflictPromptChoice = 1;
		conflictRetryFails = false;
		await applyChangesToWorkingFile.call({}, { repoPath: '/repo', fsPath: 'file' }, 'a', 'b');
		assert.deepEqual(conflictCalls.map(call => call[0]), ['apply', 'prompt', 'apply']);
		assert.equal(conflictCalls[1][1][0], '无法无冲突地应用更改。是否重试并允许冲突？');
		assert.equal(conflictCalls[1][1][1].title, '允许冲突并重试');
		assert.equal(conflictCalls[1][1][2].title, '取消');
		assert.deepEqual(conflictCalls[2][1], { allowConflicts: true });
	}],
	['cancelling conflict retry leaves the patch unapplied', async () => {
		conflictCalls.length = 0;
		conflictPromptChoice = 2;
		await applyChangesToWorkingFile.call({}, { repoPath: '/repo', fsPath: 'file' }, 'a', 'b');
		assert.deepEqual(conflictCalls.map(call => call[0]), ['apply', 'prompt']);
	}],
	['failed conflict retry reports a Chinese apply error', async () => {
		conflictCalls.length = 0;
		conflictPromptChoice = 1;
		conflictRetryFails = true;
		await applyChangesToWorkingFile.call({}, { repoPath: '/repo', fsPath: 'file' }, 'a', 'b');
		assert.deepEqual(conflictCalls.map(call => call[0]), ['apply', 'prompt', 'apply', 'error', 'message']);
		assert.deepEqual(conflictCalls[3], ['error', 'retry failed']);
		assert.deepEqual(conflictCalls[4], ['message', '无法应用更改']);
	}],
	['rebase to upstream retains local branch metadata in both tree entry points', async () => {
		for (const Node of [BranchNode, BranchTrackingStatusNode]) {
			calls.length = 0;
			const node = Object.assign(new Node(), { repoPath: '/repo', branch: makeBranch({ name: 'release/2.0', missing: false, local: true }), status: { upstream: 'release/2.0' } });
			await rebaseToUpstream.call({}, node);
			assert.equal(calls[0].remote, false);
			assert.equal(calls[0].name, 'release/2.0');
		}
	}],
	['remote tracking parser preserves a unique configured remote with slashes and ordinary origin', () => {
		for (const remoteName of ['team/origin', 'origin']) {
			const [branch] = GitBranchParser.parse(row('').replace('refs/heads/topic', `refs/remotes/${remoteName}/feature/topic`), '/repo', undefined, [remoteName]);
			assert.equal(branch.getRemoteName(), remoteName);
			assert.equal(branch.getNameWithoutRemote(), 'feature/topic');
		}
	}],
	['branch references preserve normalized remote snapshot across create and fromBranch', () => {
		const reference = GitReference.create('team/origin/feature/topic', '/repo', { refType: 'branch', name: 'team/origin/feature/topic', remote: true, remoteName: 'team/origin' });
		const copy = GitReference.fromBranch(reference);
		assert.equal(copy.remoteName, 'team/origin');
		assert.equal(GitReference.getNameWithoutRemote(copy), 'feature/topic');
	}],
	['includeAll returns providerless remotes while the default keeps webpage candidates filtered', async () => {
		const remotes = [{ name: 'local' }, { name: 'origin', provider: {} }];
		const service = { getRepository: async () => undefined, getRemotesCore: async () => remotes };
		assert.deepEqual(await getRemotes.call(service, '/repo'), [remotes[1]]);
		assert.deepEqual(await getRemotes.call(service, '/repo', { includeAll: true }), remotes);
	}],
	['branch remote validation includes providerless configured remotes', async () => {
		const branch = makeBranch({ name: 'local/topic', missing: false, remote: 'local', remoteBranch: 'topic' });
		container.git.getRemotes = async (_repoPath, options) => options?.includeAll ? [{ name: 'local' }] : [];
		assert.equal((await branch.getRemote())?.name, 'local');
	}],
	['remote file branch selection uses its remote snapshot', () => {
		const result = remoteFilePick({ refType: 'branch', remote: true, name: 'team/origin/feature/topic', remoteName: 'team/origin' }, [{ name: 'origin' }, { name: 'team/origin' }]);
		assert.equal(result.args.branchOrTag, 'feature/topic');
		assert.deepEqual(result.remotes, [{ name: 'team/origin' }]);
	}],
	['both branch views traverse a configured slash remote using branch snapshots', async () => {
		const branch = { name: 'team/origin/feature/topic', ref: 'team/origin/feature/topic', repoPath: '/repo', remote: true, remoteName: 'team/origin', getRemoteName: () => 'team/origin' };
		for (const [file, className] of [['src/views/remotesView.ts', 'RemotesView'], ['src/views/repositoriesView.ts', 'RepositoriesView']]) {
			const { invoke, instance } = viewMethod(file, className, 'findBranch', branch);
			assert.equal(await invoke.call(instance, branch), true, className);
		}
	}],
	['both commit views associate full remote branch names with canonical branch snapshots', async () => {
		const branch = { name: 'team/origin/feature/topic', remote: true, getRemoteName: () => 'team/origin' };
		for (const [file, className] of [['src/views/remotesView.ts', 'RemotesView'], ['src/views/repositoriesView.ts', 'RepositoriesView']]) {
			const { invoke, instance } = viewMethod(file, className, 'findCommit', branch);
			assert.equal(await invoke.call(instance, { repoPath: '/repo', ref: 'abc' }), true, className);
		}
	}],
	['providerless configured remotes support branch fetch and revision push', async () => {
		const branch = makeBranch({ name: 'local/topic', missing: false, remote: 'local', remoteBranch: 'topic' });
		container.git.getRemotes = async (_path, options) => options?.includeAll ? [{ name: 'local' }] : [];
		calls.length = 0;
		await fetch.call({ getRepository: async () => repository(branch) }, '/repo', { branch });
		assert.equal(calls[0][2].remote, 'local');
		calls.length = 0;
		await push.call(repository(branch), { reference: { refType: 'revision', ref: 'abc' } });
		assert.deepEqual(calls, [['push', 'local', 'abc:topic']]);
	}],
	['remote branch deletion uses the complete configured remote and branch names', async () => {
		for (const remoteName of ['team/origin', 'origin']) {
			const [branch] = GitBranchParser.parse(row('').replace('refs/heads/topic', `refs/remotes/${remoteName}/feature/topic`), '/repo', undefined, [remoteName]);
			container.git.getRemotes = async () => [{ name: remoteName }];
			calls.length = 0;
			await branchDelete.call({ path: '/repo', getBranch: async () => branch, runTerminalCommand: (...args) => calls.push(args) }, branch);
			assert.deepEqual(calls, [[['push', '-d', remoteName, 'feature/topic'], '/repo']]);
		}
	}],
	['local upstream branch deletion never adds a remote push deletion', async () => {
		const branch = makeBranch({ name: 'origin/topic', missing: false, local: true });
		container.git.getRemotes = async () => [{ name: 'origin' }];
		calls.length = 0;
		await branchDelete.call({ path: '/repo', getBranch: async () => branch, runTerminalCommand: (...args) => calls.push(args) }, branch, { remote: true });
		assert.deepEqual(calls, [[['branch', '--delete', 'topic'], '/repo']]);
	}],
	['forced local and multiple remote branch deletions each open a separate terminal', async () => {
		const local = { name: 'topic', ref: 'topic', remote: false };
		const remoteRefs = ['first/topic', 'second/other'].map(name => ({ name, ref: name, remote: true }));
		const remoteBranches = {
			'first/topic': { getRemote: async () => ({}), getRemoteName: () => 'first', getNameWithoutRemote: () => 'topic' },
			'second/other': { getRemote: async () => ({}), getRemoteName: () => 'second', getNameWithoutRemote: () => 'other' },
		};
		calls.length = 0;
		await branchDelete.call({
			path: '/repo',
			getBranch: async name => remoteBranches[name],
			runTerminalCommand: (...args) => calls.push(args),
		}, local, { force: true });
		assert.deepEqual(calls, [[['branch', '--delete', '--force', 'topic'], '/repo']]);
		calls.length = 0;
		await branchDelete.call({
			path: '/repo',
			getBranch: async name => remoteBranches[name],
			runTerminalCommand: (...args) => calls.push(args),
		}, remoteRefs);
		assert.deepEqual(calls, [
			[['push', '-d', 'first', 'topic'], '/repo'],
			[['push', '-d', 'second', 'other'], '/repo'],
		]);
	}],
	['remote comparison strips the selected complete remote prefix and preserves other prefixes', async () => {
		for (const [base, compare, expectedBase, expectedCompare] of [
			['team/origin/feature/topic', 'team/origin/main', 'feature/topic', 'main'],
			['team/originExtra/topic', 'other/topic', 'team/originExtra/topic', 'other/topic'],
		]) {
			calls.length = 0;
			await remoteProviderExecute.call({ remote: { name: 'team/origin', provider: { open: async resource => calls.push(resource) } }, resource: { type: remoteResourceType.Comparison, base, compare } });
			assert.equal(calls[0].base, expectedBase);
			assert.equal(calls[0].compare, expectedCompare);
		}
	}],
	['Bitbucket file conversion resolves slash remote branches through the canonical model', async () => {
		const [branch] = GitBranchParser.parse(row('').replace('refs/heads/topic', 'refs/remotes/team/origin/feature/topic'), '/repo', undefined, ['team/origin']);
		container.git.getBranchesAndOrTags = async (_path, options) => options.filter.branches(branch) ? [branch] : [];
		calls.length = 0;
		await remoteProviderExecute.call({ remote: { name: 'team/origin', repoPath: '/repo', provider: { id: 'bitbucket', open: async resource => calls.push(resource) } }, resource: { type: remoteResourceType.File, branchOrTag: 'feature/topic' } });
		assert.equal(calls[0].type, remoteResourceType.Revision);
		assert.equal(calls[0].sha, 'abc');
	}],
];
(async () => {
	let failures = 0;
	for (const [name, test] of cases) {
		try {
			await test();
			console.log(`PASS ${name}`);
		} catch (error) {
			failures++;
			console.error(`FAIL ${name}\n${error.stack}`);
		}
	}
	process.exitCode = failures ? 1 : 0;
})();
