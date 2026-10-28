'use strict';
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import * as net from 'net';
import * as paths from 'path';
import { Disposable, ProcessExecution, Task, TaskPanelKind, TaskRevealKind, tasks, TaskScope, Terminal, TerminalOptions, window } from 'vscode';
import { Git } from './git/git';
import { Logger } from './logger';
import { Messages } from './messages';

const extensionTerminalName = 'GitLess';
let powerShell7Path: string | null | undefined;

function getPowerShell7Path(): string | undefined {
	if (process.platform !== 'win32') return undefined;
	if (powerShell7Path === undefined) {
		const path = paths.join(process.env.ProgramW6432 ?? process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
		try {
			const major = execFileSync(path, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], {
				encoding: 'utf8',
				timeout: 2000,
				windowsHide: true,
			});
			powerShell7Path = major.trim() === '7' ? path : null;
		} catch {
			powerShell7Path = null;
		}
	}
	return powerShell7Path ?? undefined;
}

export async function runGitCommandAutomatically(args: string[], cwd: string, fallback: 'task' | 'terminal') {
	let options: TerminalOptions | undefined;
	if (process.platform === 'darwin' || process.platform === 'linux') {
		const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
		const script = `builtin cd -- ${quote(cwd)} || return\n${[Git.getGitPath(), ...args].map(quote).join(' ')}`;
		// Encode the complete startup file so VS Code cannot expand variable-like Git arguments.
		const encoded = Array.from(Buffer.from(script, 'utf8'), byte => `\\${byte.toString(8).padStart(3, '0')}`).join('');
		options = {
			shellPath: '/bin/bash',
			shellArgs: [
				'--noprofile',
				'--norc',
				'-c',
				`exec /bin/bash --noprofile --rcfile <(builtin printf "%s" $'${encoded}') -i`,
			],
			env: { BASH_ENV: null },
		};
	} else {
		const shellPath = getPowerShell7Path();
		if (shellPath != null) {
			// The shell remains interactive after Git exits. Encode data before VS Code processes shell arguments.
			const payload = Buffer.from(JSON.stringify({ gitPath: Git.getGitPath(), args: args, cwd: cwd }), 'utf8').toString('base64');
			const script = [
				`$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json`,
				'$gitPath = [string]$payload.gitPath',
				'$gitArgs = [string[]]$payload.args',
				'Set-Location -LiteralPath ([string]$payload.cwd)',
				'& $gitPath @gitArgs',
			].join('\n');
			options = {
				shellPath: shellPath,
				shellArgs: ['-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
			};
		}
	}
	if (options != null) {
		try {
			const terminal = window.createTerminal({
				...options,
				name: extensionTerminalName,
				cwd: cwd,
				isTransient: true,
			});
			terminal.show(false);
		} catch (ex) {
			Logger.error(ex);
			void Messages.showGenericErrorMessage('无法在终端运行 Git 命令');
		}
		return;
	}

	await (fallback === 'terminal' ? runGitCommandInNewTerminal(args, cwd) : runGitCommandInTask(args, cwd));
}

function getGitTerminalRunnerArgs(args: string[], cwd: string, cancelPipe?: string): [string, string] {
	// VS Code substitutes variables in process arguments, so keep Git's data opaque until the runner starts.
	const payload = Buffer.from(JSON.stringify({ gitPath: Git.getGitPath(), args: args, cwd: cwd, cancelPipe: cancelPipe })).toString(
		'base64',
	);
	return [paths.join(__dirname, 'gitTerminalRunner.js'), payload];
}

export function runGitCommandInTerminal(command: string, args: string, cwd: string) {
	// let git = Git.getGitPath();
	// if (git.includes(' ')) {
	//     git = `"${git}"`;
	// }

	const terminal = window.createTerminal({ name: extensionTerminalName, cwd: cwd });
	terminal.show(false);
	terminal.sendText(`git ${command} ${args}`, false);
}

export async function runGitCommandInTask(args: string[], cwd: string) {
	const task = new Task(
		{ type: 'gitless' },
		TaskScope.Workspace,
		extensionTerminalName,
		extensionTerminalName,
		new ProcessExecution(process.execPath, getGitTerminalRunnerArgs(args, cwd), {
			env: { ELECTRON_RUN_AS_NODE: '1' },
		}),
		[],
	);
	task.presentationOptions = {
		reveal: TaskRevealKind.Always,
		focus: true,
		panel: TaskPanelKind.New,
		close: false,
	};
	try {
		return await tasks.executeTask(task);
	} catch (ex) {
		Logger.error(ex);
		void Messages.showGenericErrorMessage('无法在终端运行 Git 命令');
		return undefined;
	}
}

export async function runGitCommandInNewTerminal(args: string[], cwd: string) {
	const id = randomBytes(16).toString('hex');
	const cancelPipe = `\\\\.\\pipe\\gitless-${id}`;
	let terminal: Terminal | undefined;
	let closeListener: Disposable | undefined;
	let socket: net.Socket | undefined;
	let closed = false;
	const server = net.createServer(connection => {
		if (closed || socket != null) {
			connection.destroy();
			return;
		}
		socket = connection;
		server.close();
		connection.on('error', close);
		connection.on('close', close);
	});
	function close() {
		if (closed) return;
		closed = true;
		closeListener?.dispose();
		socket?.destroy();
		if (server.listening) server.close();
	}

	try {
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(cancelPipe, () => {
				server.off('error', reject);
				resolve();
			});
		});
		server.on('error', error => {
			Logger.error(error);
			close();
		});
		terminal = window.createTerminal({
			name: extensionTerminalName,
			cwd: cwd,
			shellPath: process.execPath,
			shellArgs: getGitTerminalRunnerArgs(args, cwd, cancelPipe),
			env: { ELECTRON_RUN_AS_NODE: '1' },
			isTransient: true,
		});
		closeListener = window.onDidCloseTerminal(closedTerminal => {
			if (closedTerminal === terminal) close();
		});
		terminal.show(false);
	} catch (ex) {
		terminal?.dispose();
		close();
		Logger.error(ex);
		void Messages.showGenericErrorMessage('无法在终端运行 Git 命令');
	}
}
