'use strict';
import * as paths from 'path';
import { ProcessExecution, Task, TaskPanelKind, TaskRevealKind, tasks, TaskScope, window } from 'vscode';
import { Git } from './git/git';
import { Logger } from './logger';
import { Messages } from './messages';

const extensionTerminalName = 'GitLess';

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
	// Task arguments undergo VS Code variable substitution, so keep Git's data opaque until the runner starts.
	const payload = Buffer.from(JSON.stringify({ gitPath: Git.getGitPath(), args: args, cwd: cwd })).toString(
		'base64',
	);
	const task = new Task(
		{ type: 'gitless' },
		TaskScope.Workspace,
		extensionTerminalName,
		extensionTerminalName,
		new ProcessExecution(process.execPath, [paths.join(__dirname, 'gitTerminalRunner.js'), payload], {
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
