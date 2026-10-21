import { TextEditor, Uri, window } from 'vscode';
import { Container } from '../container';
import { Logger } from '../logger';
import { ActiveEditorCommand, command, Commands } from './common';

@command()
export class ToggleLineBlameCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.ToggleLineBlame);
	}

	async execute(editor: TextEditor, _uri?: Uri): Promise<void> {
		try {
			void (await Container.lineAnnotations.toggle(editor));
		} catch (ex) {
			Logger.error(ex, 'ToggleLineBlameCommand');
			void window.showErrorMessage(
				'无法切换行逐行追溯注释。有关更多详细信息，请参阅输出通道',
			);
		}
	}
}
