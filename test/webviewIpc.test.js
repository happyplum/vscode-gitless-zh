const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'src/webviews', file), 'utf8');

function evaluate(source, globals = {}) {
	const module = { exports: {} };
	const compiled = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	vm.runInNewContext(compiled, { module, exports: module.exports, ...globals });
	return module.exports;
}

function loadBoundary() {
	const errors = [];
	// Exercise the old helper before migration so red results describe its lost return value.
	const filename = fs.existsSync(path.join(root, 'src/webviews/ipc.ts')) ? 'ipc.ts' : 'protocol.ts';
	const exports = evaluate(read(filename), {
		require: name => {
			if (name === '../logger') return { Logger: { error: (...args) => errors.push(args) } };
			if (name === './protocol') return evaluate(read('protocol.ts'));
			throw new Error(`Unexpected runtime dependency: ${name}`);
		},
	});
	return { onIpcCommand: exports.onIpcCommand, errors };
}

function loadMethod(filename, className, methodName, globals) {
	const file = ts.createSourceFile(filename, read(filename), ts.ScriptTarget.Latest, true);
	const declaration = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
	const method = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === methodName);
	return evaluate(`class Fixture extends Base { ${method.getText(file)} } module.exports = Fixture;`, {
		Base: class { onMessageReceived() {} }, ...globals,
	});
}

function assertLogged(errors, error, method) {
	assert.equal(errors.length, 1, 'the boundary must record each failure exactly once');
	assert.equal(errors[0][0], error);
	assert.ok(errors[0].slice(1).some(value => typeof value === 'string' && value.includes(method)), 'log context identifies the IPC method');
}

function observedRejection(error) {
	const promise = Promise.reject(error);
	// Keep a broken implementation from causing process-level unhandled rejection noise.
	promise.catch(() => {});
	return promise;
}

test('IPC callback receives the original params once and starts synchronously', async () => {
	const { onIpcCommand, errors } = loadBoundary();
	const params = { value: 42 };
	let calls = 0;
	const result = onIpcCommand({ method: 'test/command' }, { method: 'test/command', params }, actual => {
		calls++;
		assert.equal(actual, params);
	});
	assert.equal(calls, 1);
	await result;
	assert.equal(calls, 1);
	assert.deepEqual(errors, []);
});

test('IPC boundary consumes and records a synchronous callback throw', async () => {
	const { onIpcCommand, errors } = loadBoundary();
	const error = new Error('sync failure');
	await onIpcCommand({ method: 'test/sync' }, { method: 'test/sync' }, () => { throw error; });
	assertLogged(errors, error, 'test/sync');
});

for (const kind of ['Promise', 'Thenable']) {
	test(`IPC boundary consumes and records a rejected ${kind} once`, async () => {
		const { onIpcCommand, errors } = loadBoundary();
		const error = new Error(`${kind} failure`);
		let thenCalls = 0;
		const rejected = kind === 'Promise' ? observedRejection(error) : {
			then(_resolve, reject) { thenCalls++; reject(error); },
		};
		await onIpcCommand({ method: 'test/async' }, { method: 'test/async' }, () => rejected);
		assertLogged(errors, error, 'test/async');
		if (kind === 'Thenable') assert.equal(thenCalls, 1);
	});
}

test('IPC boundary waits for successful async completion without logging', async () => {
	const { onIpcCommand, errors } = loadBoundary();
	let resolve;
	let completed = false;
	const pending = new Promise(done => { resolve = done; });
	const result = onIpcCommand({ method: 'test/success' }, { method: 'test/success' }, () => pending);
	assert.ok(result && typeof result.then === 'function', 'the boundary exposes callback completion');
	const completion = result.then(() => { completed = true; });
	await Promise.resolve();
	assert.equal(completed, false);
	resolve();
	await completion;
	assert.equal(completed, true);
	assert.deepEqual(errors, []);
});

test('Settings Ready clears its anchor immediately and hands notification failure to the boundary', async () => {
	const { onIpcCommand, errors } = loadBoundary();
	const type = { method: 'webview/ready' };
	const error = new Error('notification failed');
	const notification = observedRejection(error);
	let completion;
	const Settings = loadMethod('settingsWebview.ts', 'SettingsWebview', 'onMessageReceived', {
		ReadyCommandType: type,
		SettingsDidRequestJumpToNotificationType: { method: 'settings/jumpTo' },
		onIpcCommand: (...args) => { completion = onIpcCommand(...args); return completion; },
	});
	const settings = new Settings();
	settings._pendingJumpToAnchor = 'views';
	let calls = 0;
	settings.notify = (actualType, params) => {
		calls++;
		assert.equal(actualType.method, 'settings/jumpTo');
		assert.equal(params.anchor, 'views');
		assert.equal(settings._pendingJumpToAnchor, 'views');
		return notification;
	};
	settings.onMessageReceived({ method: type.method });
	assert.equal(settings._pendingJumpToAnchor, undefined);
	assert.equal(calls, 1);
	await completion;
	assertLogged(errors, error, type.method);
});

for (const failing of ['warning', 'open']) {
	test(`Rebase switch starts both operations immediately and consumes ${failing} rejection`, async () => {
		const { onIpcCommand, errors } = loadBoundary();
		const error = new Error(`${failing} failed`);
		const calls = [];
		const operation = name => {
			calls.push(name);
			return name === failing ? observedRejection(error) : Promise.resolve();
		};
		const Editor = loadMethod('rebaseEditor.ts', 'RebaseEditorProvider', 'switch', {
			Messages: { showRebaseSwitchToTextWarningMessage: () => operation('warning') },
			commands: { executeCommand: (command, uri, options) => {
				assert.equal(command, 'open');
				assert.equal(uri, 'document-uri');
				assert.equal(options.override, false);
				assert.equal(options.preview, false);
				return operation('open');
			} },
			BuiltInCommands: { Open: 'open' },
		});
		const context = { abortOnClose: true, document: { uri: 'document-uri' } };
		const completion = onIpcCommand({ method: 'rebase/switch' }, { method: 'rebase/switch' }, () => new Editor().switch(context));
		assert.deepEqual(calls, ['warning', 'open']);
		assert.equal(context.abortOnClose, false);
		await completion;
		assertLogged(errors, error, 'rebase/switch');
	});
}

test('all host command handlers use the host-only boundary and protocol stays browser-safe', () => {
	const protocol = ts.createSourceFile('protocol.ts', read('protocol.ts'), ts.ScriptTarget.Latest, true);
	assert.equal(protocol.statements.some(node => ts.isFunctionDeclaration(node) && node.name?.text === 'onIpcCommand'), false);
	assert.doesNotMatch(read('protocol.ts'), /from ['"](?:vscode|\.\.\/logger|\.\/ipc)['"]/);
	for (const filename of ['webviewBase.ts', 'settingsWebview.ts', 'rebaseEditor.ts']) {
		const source = read(filename);
		const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
		const boundaryImport = file.statements.find(node => ts.isImportDeclaration(node) && node.moduleSpecifier.text === './ipc');
		assert.ok(boundaryImport?.importClause?.namedBindings?.elements.some(node => node.name.text === 'onIpcCommand'), filename);
		let calls = 0;
		function visit(node) {
			if (ts.isCallExpression(node) && node.expression.getText(file) === 'onIpcCommand') {
				calls++;
				assert.ok(ts.isVoidExpression(node.parent), `${filename}: discarded boundary completion must be explicit`);
			}
			ts.forEachChild(node, visit);
		}
		visit(file);
		assert.ok(calls > 0, filename);
	}
});
