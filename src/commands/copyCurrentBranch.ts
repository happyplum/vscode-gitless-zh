'use strict';
import { env, TextEditor, Uri, window } from 'vscode';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { ActiveEditorCommand, command, Commands, getCommandUri, getRepoPathOrActiveOrPrompt } from './common';

@command()
export class CopyCurrentBranchCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.CopyCurrentBranch);
	}

	async execute(editor?: TextEditor, uri?: Uri) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = await getRepoPathOrActiveOrPrompt(gitUri, editor, '复制当前分支名称');
		if (!repoPath) return;

		try {
			const branch = await Container.git.getBranch(repoPath);
			if (branch?.name) {
				await env.clipboard.writeText(branch.name);
			}
		} catch (ex) {
			Logger.error(ex, 'CopyCurrentBranchCommand');
			void window.showErrorMessage('无法复制当前分支名称。有关更多详细信息，请参阅输出通道');
		}
	}
}
