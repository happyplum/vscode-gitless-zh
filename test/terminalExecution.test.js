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

function loadTerminal(taskFailure, terminalFailure, powerShellMajor = '7') {
	const calls = { tasks: [], terminals: [], executions: [], errors: [], messages: [], servers: [], closeListeners: [], order: [], detections: [] };
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
			if (terminalFailure) throw terminalFailure;
			const terminal = { options, show: value => { terminal.shown = value; }, sendText: (...args) => { terminal.sent = args; } };
			calls.terminals.push(terminal);
			calls.order.push('terminal');
			return terminal;
		}, onDidCloseTerminal: listener => {
			calls.closeListeners.push(listener);
			return { dispose: () => { calls.closeListeners = calls.closeListeners.filter(item => item !== listener); } };
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
			if (name === 'child_process') return { execFileSync: (...args) => {
				calls.detections.push(args);
				if (powerShellMajor == null) throw new Error('PowerShell 7 unavailable');
				return `${powerShellMajor}\n`;
			} };
			if (name === 'net') return { createServer: onConnection => {
				const server = new EventEmitter();
				server.listening = false;
				server.listen = (address, callback) => {
					server.address = address;
					server.listening = true;
					calls.order.push('listen');
					callback();
				};
				server.close = callback => {
					server.listening = false;
					server.closed = true;
					callback?.();
				};
				server.accept = socket => onConnection(socket);
				calls.servers.push(server);
				return server;
			} };
			if (name === './logger') return { Logger: { error: error => calls.errors.push(error) } };
			if (name === './messages') return { Messages: { showGenericErrorMessage: message => { calls.messages.push(message); return Promise.resolve(); } } };
			if (/(?:^|\/)git(?:\/git)?$/.test(name)) return { Git: { getGitPath: () => gitPath } };
			return require(name);
		},
		module, exports: module.exports, process, Buffer, __dirname: path.join(root, 'dist'),
	});
	return { ...module.exports, calls, gitPath, closeTerminal: closed => calls.closeListeners.slice().forEach(listener => listener(closed)) };
}

function loadRepositoryTerminalMethods(terminal) {
	const terminalCalls = [];
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
		runGitCommandAutomatically: (args, cwd, fallback) => { terminalCalls.push({ args, cwd, fallback }); return Promise.resolve(); },
		RepositoryChange: { Unknown: 'unknown' }, setTimeout: () => undefined,
	});
	const repository = new module.exports();
	repository.path = 'C:\\repo';
	repository.terminalCalls = terminalCalls;
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

function loadCancellableRunner(payload, options = {}) {
	const calls = [];
	const timers = [];
	const control = new EventEmitter();
	control.destroy = () => { control.destroyed = true; control.emit('close'); };
	const git = new EventEmitter();
	git.pid = 4321;
	git.exitCode = null;
	git.kill = () => { git.killed = true; };
	const killer = new EventEmitter();
	const fakeProcess = new EventEmitter();
	Object.assign(fakeProcess, {
		argv: [process.execPath, runnerPath, Buffer.from(JSON.stringify(payload)).toString('base64')],
		env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
		platform: options.platform ?? 'win32',
		pid: 9876,
		kill: (...args) => calls.push(['kill', ...args]),
		exitCode: undefined,
	});
	const module = { exports: {} };
	vm.runInNewContext(fs.readFileSync(runnerPath, 'utf8'), {
		require: name => {
			if (name === 'net' || name === 'node:net') return { createConnection: address => { calls.push(['connect', address]); return control; } };
			if (name === 'child_process' || name === 'node:child_process') return {
				spawn: (...args) => { calls.push(['spawn', ...args]); return args[0] === 'taskkill.exe' ? killer : git; },
				spawnSync: (...args) => { calls.push(['spawnSync', ...args]); return options.groupResult ?? { status: 0, stdout: '9876\n' }; },
			};
			return require(name);
		},
		module, exports: module.exports, process: fakeProcess, Buffer, console,
		setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
	});
	return { calls, control, git, killer, process: fakeProcess, timers };
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

test('legacy branch deletion listens for cancellation before opening an opaque native terminal', async () => {
	const terminal = loadTerminal();
	const cwd = 'C:\\repo ${workspaceFolder}\\中文';
	await terminal.runGitCommandInNewTerminal(specialArgs, cwd);
	assert.equal(terminal.calls.executions.length, 0);
	assert.equal(terminal.calls.terminals.length, 1);
	assert.deepEqual(terminal.calls.order, ['listen', 'terminal']);
	const opened = terminal.calls.terminals[0];
	assert.equal(opened.options.name, 'GitLess');
	assert.equal(opened.options.cwd, cwd);
	assert.equal(opened.options.shellPath, process.execPath);
	assert.equal(opened.options.env.ELECTRON_RUN_AS_NODE, '1');
	assert.equal(opened.options.isTransient, true);
	assert.equal(path.basename(opened.options.shellArgs[0]), 'gitTerminalRunner.js');
	const payload = JSON.parse(Buffer.from(opened.options.shellArgs[1], 'base64').toString('utf8'));
	assert.deepEqual({ gitPath: payload.gitPath, args: payload.args, cwd: payload.cwd }, { gitPath: terminal.gitPath, args: specialArgs, cwd });
	assert.equal(payload.cancelPipe, terminal.calls.servers[0].address);
	assert.equal(opened.shown, false);
	assert.equal(opened.sent, undefined, 'automatic execution must not send shell text');
	terminal.closeTerminal(opened);
	assert.equal(terminal.calls.servers[0].closed, true);
});

test('Windows PowerShell 7 automatic Git opens a fresh interactive shell with opaque arguments', async () => {
	const terminal = loadTerminal();
	const cwd = 'C:\\repo ${workspaceFolder}\\中文';
	await terminal.runGitCommandAutomatically(specialArgs, cwd, 'terminal');
	await terminal.runGitCommandAutomatically(['status'], cwd, 'task');
	assert.equal(terminal.calls.terminals.length, 2, 'each command must preserve drafts in existing terminals');
	assert.equal(terminal.calls.executions.length, 0);
	assert.equal(terminal.calls.servers.length, 0);
	assert.equal(terminal.calls.detections.length, 1, 'PowerShell detection should be cached');
	const opened = terminal.calls.terminals[0];
	assert.equal(opened.options.name, 'GitLess');
	assert.equal(opened.options.cwd, cwd);
	assert.match(opened.options.shellPath, /(?:^|\\)pwsh\.exe$/i);
	assert.equal(opened.options.env?.ELECTRON_RUN_AS_NODE, undefined);
	assert.equal(opened.options.isTransient, true);
	assert.deepEqual(Array.from(opened.options.shellArgs).slice(0, 4), ['-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand']);
	const launcher = Buffer.from(opened.options.shellArgs[4], 'base64').toString('utf16le');
	const payloads = [...launcher.matchAll(/'([A-Za-z0-9+/]{80,}={0,2})'/g)].map(match => {
		try { return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')); } catch { return undefined; }
	});
	const payload = payloads.find(value => value?.args != null);
	assert.deepEqual({ gitPath: payload.gitPath, args: payload.args, cwd: payload.cwd }, { gitPath: terminal.gitPath, args: specialArgs, cwd });
	assert.match(launcher, /Set-Location -LiteralPath/);
	assert.match(launcher, /& \$gitPath @gitArgs/);
	for (const arg of specialArgs) assert.equal(launcher.includes(arg), false, 'Git arguments must stay opaque to PowerShell');
	assert.equal(opened.shown, false);
	assert.equal(opened.sent, undefined, 'automatic execution must not send shell text');
});

test('without PowerShell 7 automatic Git retains the existing caller-specific backends', async () => {
	const terminal = loadTerminal(undefined, undefined, '5');
	await terminal.runGitCommandAutomatically(['status'], root, 'task');
	await terminal.runGitCommandAutomatically(['branch', '--delete', 'topic'], root, 'terminal');
	assert.equal(terminal.calls.executions.length, 1);
	assert.equal(terminal.calls.terminals.length, 1);
	assert.equal(terminal.calls.terminals[0].options.shellPath, process.execPath);
});

test('branch deletion terminal creation failure closes its cancellation listener and is reported', async () => {
	const error = new Error('Cannot create a native terminal');
	const terminal = loadTerminal(undefined, error);
	await terminal.runGitCommandInNewTerminal(['branch', '--delete', 'topic'], root);
	assert.deepEqual(terminal.calls.errors, [error]);
	assert.equal(terminal.calls.messages.length, 1);
	assert.equal(terminal.calls.servers[0].closed, true);
});

test('closing one branch deletion terminal only cancels its own connected runner', async () => {
	const terminal = loadTerminal();
	await terminal.runGitCommandInNewTerminal(['branch', '--delete', 'first'], root);
	await terminal.runGitCommandInNewTerminal(['branch', '--delete', 'second'], root);
	const sockets = Array.from({ length: 2 }, () => {
		const socket = new EventEmitter();
		socket.destroy = () => { socket.destroyed = true; socket.emit('close'); };
		return socket;
	});
	terminal.calls.servers.forEach((server, index) => server.accept(sockets[index]));
	terminal.closeTerminal(terminal.calls.terminals[0]);
	assert.equal(sockets[0].destroyed, true);
	assert.notEqual(sockets[1].destroyed, true);
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
	assert.equal(repository.terminalCalls.length, 1);
	assert.deepEqual(Array.from(repository.terminalCalls[0].args), ['-c', 'sequence.editor=code --wait --reuse-window', 'rebase', '--interactive', 'topic${workspaceFolder}']);
	assert.equal(repository.terminalCalls[0].fallback, 'task');
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

test('cancellable runner waits for its IPC connection before starting Git', () => {
	const runner = loadCancellableRunner({ gitPath: 'git', args: specialArgs, cwd: root, cancelPipe: '\\\\.\\pipe\\gitless-test' });
	assert.deepEqual(runner.calls, [['connect', '\\\\.\\pipe\\gitless-test']]);
	runner.control.emit('error', new Error('terminal closed before connecting'));
	assert.equal(runner.calls.filter(call => call[0] === 'spawn').length, 0);
	assert.notEqual(runner.process.exitCode, 0);
});

test('closing a connected runner terminates only its Git process tree', () => {
	const runner = loadCancellableRunner({ gitPath: 'git', args: specialArgs, cwd: root, cancelPipe: '\\\\.\\pipe\\gitless-test' });
	runner.control.emit('connect');
	const gitCall = runner.calls.find(call => call[0] === 'spawn');
	assert.equal(gitCall[1], 'git');
	assert.deepEqual(Array.from(gitCall[2]), specialArgs);
	assert.equal(gitCall[3].shell, false);
	runner.control.emit('close');
	const killCall = runner.calls.find(call => call[1] === 'taskkill.exe');
	assert.deepEqual(Array.from(killCall[2]), ['/PID', '4321', '/T', '/F']);
	assert.equal(killCall[3].shell, false);
});

test('completed Git closes IPC and preserves its exit code without process-tree termination', () => {
	const runner = loadCancellableRunner({ gitPath: 'git', args: ['push', '-d', 'origin', 'topic'], cwd: root, cancelPipe: '\\\\.\\pipe\\gitless-test' });
	runner.control.emit('connect');
	runner.git.emit('exit', 17);
	assert.equal(runner.process.exitCode, 17);
	assert.equal(runner.control.destroyed, true);
	assert.equal(runner.calls.filter(call => call[1] === 'taskkill.exe').length, 0);
});

test('POSIX runner refuses to start Git when it does not own its terminal process group', () => {
	const runner = loadCancellableRunner(
		{ gitPath: 'git', args: ['branch', '-d', 'topic'], cwd: root, cancelPipe: '/tmp/gitless-test.sock' },
		{ platform: 'linux', groupResult: { status: 0, stdout: '1234\n' } },
	);
	runner.control.emit('connect');
	assert.deepEqual(Array.from(runner.calls[1][2]), ['-o', 'pgid=', '-p', '9876']);
	assert.equal(runner.calls.filter(call => call[0] === 'spawn').length, 0);
	assert.equal(runner.calls.filter(call => call[0] === 'kill').length, 0);
	assert.equal(runner.process.exitCode, 1);
});

test('POSIX runner keeps the controlling terminal and kills its group after Git exits during cancellation', () => {
	const runner = loadCancellableRunner(
		{ gitPath: 'git', args: ['push', '-d', 'origin', 'topic'], cwd: root, cancelPipe: '/tmp/gitless-test.sock' },
		{ platform: 'linux' },
	);
	runner.control.emit('connect');
	const gitCall = runner.calls.find(call => call[0] === 'spawn');
	assert.equal(gitCall[3].stdio, 'inherit');
	assert.equal(gitCall[3].detached, undefined);
	runner.control.emit('close');
	assert.deepEqual(runner.calls.filter(call => call[0] === 'kill'), [['kill', -9876, 'SIGTERM']]);
	runner.git.emit('exit', 0);
	assert.equal(runner.timers.length, 1);
	assert.equal(runner.timers[0].delay, 2000);
	runner.timers[0].callback();
	assert.deepEqual(runner.calls.filter(call => call[0] === 'kill'), [
		['kill', -9876, 'SIGTERM'],
		['kill', -9876, 'SIGKILL'],
	]);
});

test('POSIX runner cancels the group when Git has exited but its descendants may still be running', () => {
	const runner = loadCancellableRunner(
		{ gitPath: 'git', args: ['push', '-d', 'origin', 'topic'], cwd: root, cancelPipe: '/tmp/gitless-test.sock' },
		{ platform: 'linux' },
	);
	runner.control.emit('connect');
	runner.git.exitCode = 0;
	runner.control.emit('close');
	assert.deepEqual(runner.calls.filter(call => call[0] === 'kill'), [['kill', -9876, 'SIGTERM']]);
	assert.equal(runner.timers.length, 1);
});

test('interactive rebase passes sequence.editor as one unquoted Git config value', () => {
	const source = fs.readFileSync(path.join(root, 'src', 'commands', 'git', 'rebase.ts'), 'utf8');
	assert.match(source, /configs = \['-c', `sequence\.editor=\$\{editor\}`\]/);
});

test('repository routes automatic execution to the interactive terminal with structured arguments', () => {
	const terminal = loadTerminal();
	const repository = loadRepositoryTerminalMethods(terminal);
	repository.runTerminalCommand(...specialArgs);
	assert.equal(terminal.calls.executions.length, 0, 'automatic Git commands must not open a Task terminal');
	assert.deepEqual(repository.terminalCalls.map(call => ({ args: Array.from(call.args), cwd: call.cwd })), [
		{ args: specialArgs, cwd: 'C:\\repo' },
	]);
	assert.equal(repository.terminalCalls[0].fallback, 'task');
});
