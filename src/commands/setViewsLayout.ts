'use strict';
import { commands, window } from 'vscode';
import { viewsConfigKeys } from '../configuration';
import { command, Command, Commands } from './common';

enum ViewsLayout {
	GitLens = 'gitlens',
	SourceControl = 'scm',
}

export interface SetViewsLayoutCommandArgs {
	layout: ViewsLayout;
}

@command()
export class SetViewsLayoutCommand extends Command {
	constructor() {
		super(Commands.SetViewsLayout);
	}

	async execute(args?: SetViewsLayoutCommandArgs) {
		let layout = args?.layout;
		if (layout == null) {
			const pick = await window.showQuickPick(
				[
					{
						label: '源代码控制布局',
						description: '（默认）',
						detail: '在源代码管理侧栏上一起显示所有视图',
						layout: ViewsLayout.SourceControl,
					},
					{
						label: 'GitLess 布局',
						description: '',
						detail: '在 GitLess 侧栏上一起显示所有视图',
						layout: ViewsLayout.GitLens,
					},
				],
				{
					placeHolder: '选择 GitLess 视图布局',
				},
			);
			if (pick == null) return;

			layout = pick.layout;
		}

		switch (layout) {
			case ViewsLayout.GitLens:
				try {
					// Because of https://github.com/microsoft/vscode/issues/105774, run the command twice which seems to fix things
					let count = 0;
					while (count++ < 2) {
						void (await commands.executeCommand('vscode.moveViews', {
							viewIds: viewsConfigKeys.map(view => `gitlens.views.${view}`),
							destinationId: 'workbench.view.extension.gitlens',
						}));
					}
				} catch {}

				break;
			case ViewsLayout.SourceControl:
				try {
					// Because of https://github.com/microsoft/vscode/issues/105774, run the command twice which seems to fix things
					let count = 0;
					while (count++ < 2) {
						void (await commands.executeCommand('vscode.moveViews', {
							viewIds: viewsConfigKeys.map(view => `gitlens.views.${view}`),
							destinationId: 'workbench.view.scm',
						}));
					}
				} catch {
					for (const view of viewsConfigKeys) {
						void (await commands.executeCommand(`gitlens.views.${view}.resetViewLocation`));
					}
				}

				break;
		}
	}
}
