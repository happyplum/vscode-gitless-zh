'use strict';
import { randomBytes } from 'crypto';
import { unlink } from 'fs';
import * as net from 'net';
import { tmpdir } from 'os';
import * as paths from 'path';
import { Disposable, ProcessExecution, Task, TaskPanelKind, TaskRevealKind, tasks, TaskScope, Terminal, window } from 'vscode';
import { Git } from './git/git';
import { Logger } from './logger';
import { Messages } from './messages';

const extensionTerminalName = 'GitLess';

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
	const cancelPipe =
		process.platform === 'win32' ? `\\\\.\\pipe\\gitless-${id}` : paths.join(tmpdir(), `gitless-${id}.sock`);
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
	if (process.platform !== 'win32') {
		server.once('close', () => unlink(cancelPipe, () => undefined));
	}

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
