'use strict';
import { env, Range, Uri, window } from 'vscode';
import { Container } from '../container';
import { command, Command, Commands, openEditor } from './common';

@command()
export class OpenFileFromRemoteCommand extends Command {
	constructor() {
		super(Commands.OpenFileFromRemote);
	}

	async execute() {
		let clipboard: string | undefined = await env.clipboard.readText();
		try {
			Uri.parse(clipboard, true);
		} catch {
			clipboard = undefined;
		}

		const url = await window.showInputBox({
			prompt: '输入要打开的远程文件 URL',
			placeHolder: '远程文件 URL',
			value: clipboard,
			ignoreFocusOut: true,
		});
		if (url == null || url.length === 0) return;

		let local = await Container.git.getLocalInfoFromRemoteUri(Uri.parse(url));
		if (local == null) {
			local = await Container.git.getLocalInfoFromRemoteUri(Uri.parse(url), { validate: false });
			if (local == null) {
				void window.showWarningMessage('无法解析提供的远程 URL。');

				return;
			}

			const confirm = 'Open File...';
			const pick = await window.showWarningMessage(
				'无法找到与提供的远程 URL 匹配的工作区文件夹。',
				confirm,
			);
			if (pick !== confirm) return;
		}

		let selection;
		if (local.startLine) {
			if (local.endLine) {
				selection = new Range(local.startLine - 1, 0, local.endLine, 0);
			} else {
				selection = new Range(local.startLine - 1, 0, local.startLine - 1, 0);
			}
		}

		try {
			await openEditor(local.uri, { selection: selection, rethrow: true });
		} catch {
			const uris = await window.showOpenDialog({
				title: '打开本地文件',
				defaultUri: local.uri,
				canSelectMany: false,
				canSelectFolders: false,
			});
			if (uris == null || uris.length === 0) return;

			await openEditor(uris[0]);
		}
	}
}
