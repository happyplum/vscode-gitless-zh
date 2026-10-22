'use strict';
const { spawn } = require('child_process');

const { gitPath, args, cwd } = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
// This flag starts the VS Code executable as Node; Git and its editors need their normal environment.
delete process.env.ELECTRON_RUN_AS_NODE;
const child = spawn(gitPath, args, { cwd: cwd, shell: false, stdio: 'inherit' });
child.on('error', error => {
	console.error(error.message);
	process.exitCode = 1;
});
child.on('exit', code => {
	process.exitCode = code ?? 1;
});
