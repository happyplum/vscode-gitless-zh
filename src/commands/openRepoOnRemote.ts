'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { RemoteResourceType } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	executeCommand,
	getCommandUri,
	getRepoPathOrActiveOrPrompt,
	isCommandContextViewNodeHasRemote,
} from './common';
import { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenRepoOnRemoteCommandArgs {
	clipboard?: boolean;
	remote?: string;
}

@command()
export class OpenRepoOnRemoteCommand extends ActiveEditorCommand {
	constructor() {
		super([Commands.OpenRepoOnRemote, Commands.Deprecated_OpenRepoInRemote, Commands.CopyRemoteRepositoryUrl]);
	}

	protected override preExecute(context: CommandContext, args?: OpenRepoOnRemoteCommandArgs) {
		if (isCommandContextViewNodeHasRemote(context)) {
			args = { ...args, remote: context.node.remote.name };
		}

		if (context.command === Commands.CopyRemoteRepositoryUrl) {
			args = { ...args, clipboard: true };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenRepoOnRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = await getRepoPathOrActiveOrPrompt(
			gitUri,
			editor,
			args?.clipboard
				? '选择要复制链接的仓库'
				: '选择要在远程平台打开的仓库',
		);
		if (!repoPath) return;

		try {
			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
				resource: {
					type: RemoteResourceType.Repo,
				},
				repoPath: repoPath,
				remote: args?.remote,
				clipboard: args?.clipboard,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenRepoOnRemoteCommand');
			void window.showErrorMessage(
				'无法打开远程提供程序上的仓库。有关更多详细信息，请参阅输出通道',
			);
		}
	}
}
