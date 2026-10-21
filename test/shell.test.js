// Run with: node test/shell.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const originalError = Object.assign(new Error('git failed'), { code: 128 });
const moduleUnderTest = { exports: {} };
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/git/shell.ts'), 'utf8'), {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const localRequire = name => {
	if (name === 'child_process') return { execFile: (_command, _args, _options, callback) => {
		callback(originalError, Buffer.from('partial output\n'), Buffer.from('fatal: git failed\n'));
		return {};
	} };
	if (name === '../logger') return { Logger: { warn: () => undefined } };
	return require(name);
};
new Function('require', 'module', 'exports', source)(localRequire, moduleUnderTest, moduleUnderTest.exports);
const { run, RunError } = moduleUnderTest.exports;

(async () => {
	await assert.rejects(run('git', ['show'], 'buffer', { encoding: 'buffer' }), error => {
		assert.ok(error instanceof RunError);
		assert.strictEqual(error.original, originalError);
		assert.strictEqual(error.message, originalError.message);
		assert.strictEqual(error.code, 128);
		assert.strictEqual(error.stdout, 'partial output\n');
		assert.strictEqual(error.stderr, 'fatal: git failed\n');
		return true;
	});
	console.log('shell buffer error regression passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
