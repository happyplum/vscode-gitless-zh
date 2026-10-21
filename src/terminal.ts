'use strict';
import { window } from 'vscode';

const extensionTerminalName = 'GitLess';

export function runGitCommandInTerminal(command: string, args: string, cwd: string, execute: boolean = false) {
	// let git = Git.getGitPath();
	// if (git.includes(' ')) {
	//     git = `"${git}"`;
	// }

	const terminal = window.createTerminal({ name: extensionTerminalName, cwd: cwd });
	terminal.show(false);
	terminal.sendText(`git ${command} ${args}`, execute);
}
