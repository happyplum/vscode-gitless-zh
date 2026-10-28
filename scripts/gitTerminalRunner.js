'use strict';
const { spawn } = require('child_process');
const { createConnection } = require('net');

const { gitPath, args, cwd, cancelPipe } = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
// This flag starts the VS Code executable as Node; Git and its editors need their normal environment.
delete process.env.ELECTRON_RUN_AS_NODE;

let child;
let control;
let finished = false;
let cancelling = false;

function finish(code) {
	if (finished) return;
	finished = true;
	process.exitCode = code;
	control?.destroy();
}

function runGit() {
	if (cancelling) return;
	child = spawn(gitPath, args, {
		cwd: cwd,
		shell: false,
		stdio: 'inherit',
	});
	child.on('error', error => {
		console.error(error.message);
		if (!cancelling) finish(1);
	});
	child.on('exit', code => {
		finish(cancelling ? 130 : code ?? 1);
	});
}

function cancel() {
	if (finished || cancelling) return;
	cancelling = true;
	if (child?.pid == null || child.exitCode != null) {
		finish(130);
		return;
	}
	const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
		shell: false,
		stdio: 'ignore',
	});
	killer.on('error', error => {
		console.error(error.message);
		child.kill();
		finish(130);
	});
	killer.on('exit', () => {
		if (child.exitCode == null) child.kill();
		finish(130);
	});
}

if (cancelPipe) {
	for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, cancel);
	control = createConnection(cancelPipe);
	control.on('connect', runGit);
	control.on('error', error => {
		console.error(error.message);
		if (child == null) finish(1);
		else cancel();
	});
	control.on('close', () => {
		if (child == null) finish(1);
		else cancel();
	});
} else {
	runGit();
}
