const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const runnerPath = path.join(root, 'scripts', 'gitTerminalRunner.js');
const specialArgs = ['branch', '--delete', 'topic;Write-Output', 'topic${workspaceFolder}', 'space and "quote"', "single'quote", '$(echo injected)', 'a&b', '#topic', '(topic)', '中文'];

function loadTerminal(taskFailure) {
	const calls = { tasks: [], terminals: [], executions: [], errors: [], messages: [] };
	const vscode = {
		TaskScope: { Workspace: 2 },
		TaskRevealKind: { Always: 1 },
		TaskPanelKind: { New: 3 },
		ProcessExecution: class {
			constructor(process, args, options) { Object.assign(this, { process, args, options }); }
		},
		Task: class {
			constructor(definition, scope, name, source, execution, problemMatchers) {
				Object.assign(this, { definition, scope, name, source, execution, problemMatchers });
				calls.tasks.push(this);
			}
		},
		tasks: { executeTask: task => {
			calls.executions.push(task);
			if (taskFailure?.synchronous) throw taskFailure.error;
			return taskFailure ? Promise.reject(taskFailure.error) : Promise.resolve({ task });
		} },
		window: { createTerminal: options => {
			const terminal = { options, show: value => { terminal.shown = value; }, sendText: (...args) => { terminal.sent = args; } };
			calls.terminals.push(terminal);
			return terminal;
		} },
	};
	const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src', 'terminal.ts'), 'utf8'), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
	}).outputText;
	const module = { exports: {} };
	const gitPath = 'C:\\Program Files\\Git ${workspaceFolder}\\cmd\\git.exe';
	vm.runInNewContext(source, {
		require: name => {
			if (name === 'vscode') return vscode;
			if (name === './logger') return { Logger: { error: error => calls.errors.push(error) } };
			if (name === './messages') return { Messages: { showGenericErrorMessage: message => { calls.messages.push(message); return Promise.resolve(); } } };
			if (/(?:^|\/)git(?:\/git)?$/.test(name)) return { Git: { getGitPath: () => gitPath } };
			return require(name);
		},
		module, exports: module.exports, process, Buffer, __dirname: path.join(root, 'dist'),
	});
	return { ...module.exports, calls, gitPath };
}

function loadRepositoryTerminalMethods(terminal) {
	const file = ts.createSourceFile('repository.ts', fs.readFileSync(path.join(root, 'src/git/models/repository.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
	const repositoryClass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'Repository');
	const methods = ['rebase', 'runTerminalCommand'].map(name => {
		const method = repositoryClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
		return method.getText(file);
	});
	const source = ts.transpileModule(`class Repository { ${methods.join('\n')} } module.exports = Repository;`, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true },
	}).outputText;
	const module = { exports: {} };
	vm.runInNewContext(source, {
		module, exports: module.exports,
		gate: () => () => undefined, log: () => () => undefined,
		runGitCommandInTask: terminal.runGitCommandInTask,
		RepositoryChange: { Unknown: 'unknown' }, setTimeout: () => undefined,
	});
	const repository = new module.exports();
	repository.path = 'C:\\repo';
	return repository;
}

function runRunner(payload, event = 'exit', result = 0) {
	const calls = [];
	const child = new EventEmitter();
	const fakeProcess = {
		argv: [process.execPath, runnerPath, Buffer.from(JSON.stringify(payload)).toString('base64')],
		env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
		stderr: { write: () => undefined },
		exitCode: undefined,
		exit: code => { fakeProcess.exitCode = code; },
	};
	const module = { exports: {} };
	vm.runInNewContext(fs.readFileSync(runnerPath, 'utf8'), {
		require: name => name === 'child_process' || name === 'node:child_process' ? {
			spawn: (...args) => { calls.push(args); return child; },
		} : require(name),
		module, exports: module.exports, process: fakeProcess, Buffer, console,
	});
	child.emit(event, result);
	return { calls, exitCode: fakeProcess.exitCode, env: fakeProcess.env };
}

test('automatic execution uses a process task with opaque payload and a focused independent terminal', async () => {
	const terminal = loadTerminal();
	assert.equal(typeof terminal.runGitCommandInTask, 'function', 'automatic execution must have a structured task entry point');
	const cwd = 'C:\\repo ${workspaceFolder}\\中文';
	await terminal.runGitCommandInTask(specialArgs, cwd);
	assert.equal(terminal.calls.terminals.length, 0, 'automatic execution must not send shell text');
	assert.equal(terminal.calls.executions.length, 1);
	const task = terminal.calls.executions[0];
	assert.equal(task.execution.process, process.execPath);
	assert.equal(task.execution.options.env.ELECTRON_RUN_AS_NODE, '1');
	assert.equal(task.execution.args.length, 2);
	assert.equal(path.basename(task.execution.args[0]), 'gitTerminalRunner.js');
	const encoded = task.execution.args[1];
	assert.match(encoded, /^[A-Za-z0-9+/]+=*$/);
	assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')), { gitPath: terminal.gitPath, args: specialArgs, cwd });
	assert.equal(task.presentationOptions.reveal, 1);
	assert.equal(task.presentationOptions.panel, 3);
	assert.equal(task.presentationOptions.focus, true);
	assert.notEqual(task.presentationOptions.close, true);
});

test('manual remote removal keeps the default-shell editable prefill without execution', () => {
	const terminal = loadTerminal();
	terminal.runGitCommandInTerminal('remote', 'remove origin', 'C:\\repo');
	assert.equal(terminal.calls.tasks.length, 0);
	assert.equal(terminal.calls.terminals.length, 1);
	assert.deepEqual(JSON.parse(JSON.stringify(terminal.calls.terminals[0].options)), { name: 'GitLess', cwd: 'C:\\repo' });
	assert.deepEqual(terminal.calls.terminals[0].sent, ['git remote remove origin', false]);
	assert.equal(terminal.calls.terminals[0].shown, false);
});

test('interactive Repository rebase preserves config, subcommand, flags and reference as separate argv', () => {
	const terminal = loadTerminal();
	const repository = loadRepositoryTerminalMethods(terminal);
	repository.rebase(['-c', 'sequence.editor=code --wait --reuse-window'], '--interactive', 'topic${workspaceFolder}');
	assert.equal(terminal.calls.executions.length, 1);
	const payload = JSON.parse(Buffer.from(terminal.calls.executions[0].execution.args[1], 'base64').toString('utf8'));
	assert.deepEqual(payload.args, ['-c', 'sequence.editor=code --wait --reuse-window', 'rebase', '--interactive', 'topic${workspaceFolder}']);
});

for (const synchronous of [false, true]) {
	test(`task startup ${synchronous ? 'throw' : 'rejection'} is reported without escaping the automatic entry point`, async () => {
		const error = new Error('The current environment cannot start a process task');
		const terminal = loadTerminal({ synchronous, error });
		await terminal.runGitCommandInTask(['status'], root);
		assert.deepEqual(terminal.calls.errors, [error]);
		assert.equal(terminal.calls.messages.length, 1);
		assert.equal(typeof terminal.calls.messages[0], 'string');
	});
}

test('runner sends each special argument literally to one shell-free child', () => {
	const payload = { gitPath: 'C:\\Git ${workspaceFolder}\\git.exe', args: specialArgs, cwd: 'C:\\repo with spaces' };
	const result = runRunner(payload);
	assert.equal(result.calls.length, 1, 'no second command or shell may be spawned');
	const [command, args, options] = result.calls[0];
	assert.equal(command, payload.gitPath);
	assert.deepEqual(Array.from(args), specialArgs);
	assert.equal(options.cwd, payload.cwd);
	assert.equal(options.shell, false);
	assert.equal(options.stdio, 'inherit');
	assert.equal(result.env.ELECTRON_RUN_AS_NODE, undefined, 'the runner-only Electron flag must not reach Git or its editor');
});

test('runner preserves a Git failure exit code', () => {
	assert.equal(runRunner({ gitPath: 'git', args: ['status'], cwd: root }, 'exit', 17).exitCode, 17);
});

test('runner reports a nonzero exit when Git cannot start', () => {
	assert.equal(runRunner({ gitPath: 'missing-git', args: ['status'], cwd: root }, 'error', new Error('ENOENT')).exitCode, 1);
});

test('interactive rebase passes sequence.editor as one unquoted Git config value', () => {
	const source = fs.readFileSync(path.join(root, 'src', 'commands', 'git', 'rebase.ts'), 'utf8');
	assert.match(source, /configs = \['-c', `sequence\.editor=\$\{editor\}`\]/);
});

test('repository hands automatic execution structured arguments without shell quoting', () => {
	const terminal = loadTerminal();
	const repository = loadRepositoryTerminalMethods(terminal);
	repository.runTerminalCommand(...specialArgs);
	assert.equal(terminal.calls.executions.length, 1);
	const payload = JSON.parse(Buffer.from(terminal.calls.executions[0].execution.args[1], 'base64').toString('utf8'));
	assert.deepEqual(payload.args, specialArgs);
});
