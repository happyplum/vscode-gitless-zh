'use strict';
import { ConfigurationTarget, env, MessageItem, Uri, window } from 'vscode';
import { configuration } from './configuration';
import { GitCommit } from './git/git';
import { Logger } from './logger';

export enum SuppressedMessages {
	CommitHasNoPreviousCommitWarning = 'suppressCommitHasNoPreviousCommitWarning',
	CommitNotFoundWarning = 'suppressCommitNotFoundWarning',
	CreatePullRequestPrompt = 'suppressCreatePullRequestPrompt',
	SuppressDebugLoggingWarning = 'suppressDebugLoggingWarning',
	FileNotUnderSourceControlWarning = 'suppressFileNotUnderSourceControlWarning',
	GitDisabledWarning = 'suppressGitDisabledWarning',
	GitMissingWarning = 'suppressGitMissingWarning',
	GitVersionWarning = 'suppressGitVersionWarning',
	IncorrectWorkspaceCasingWarning = 'suppressImproperWorkspaceCasingWarning',
	LineUncommittedWarning = 'suppressLineUncommittedWarning',
	NoRepositoryWarning = 'suppressNoRepositoryWarning',
	RebaseSwitchToTextWarning = 'suppressRebaseSwitchToTextWarning',
}

export class Messages {
	static showCommitHasNoPreviousCommitWarningMessage(commit?: GitCommit): Promise<MessageItem | undefined> {
		if (commit === undefined) {
			return Messages.showMessage(
				'info',
				'没有上一个提交。',
				SuppressedMessages.CommitHasNoPreviousCommitWarning,
			);
		}
		return Messages.showMessage(
			'info',
			`提交 ${commit.shortSha}（${commit.author}，${commit.formattedDate}）没有上一个提交。`,
			SuppressedMessages.CommitHasNoPreviousCommitWarning,
		);
	}

	static showCommitNotFoundWarningMessage(message: string): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'warn',
			`${message}。找不到该提交。`,
			SuppressedMessages.CommitNotFoundWarning,
		);
	}

	static async showCreatePullRequestPrompt(branch: string): Promise<boolean> {
		const create = { title: '创建拉取请求...' };
		const result = await Messages.showMessage(
			'info',
			`要为分支“${branch}”创建拉取请求吗？`,
			SuppressedMessages.CreatePullRequestPrompt,
			{ title: '不再显示' },
			create,
		);
		return result === create;
	}

	static async showDebugLoggingWarningMessage(): Promise<boolean> {
		const disable = { title: '关闭调试日志' };
		const result = await Messages.showMessage(
			'warn',
			'GitLess 调试日志已开启。除非正在报告问题，建议关闭。现在关闭吗？',
			SuppressedMessages.SuppressDebugLoggingWarning,
			{ title: '不再显示' },
			disable,
		);

		return result === disable;
	}

	static async showGenericErrorMessage(message: string): Promise<MessageItem | undefined> {
		const actions: MessageItem[] = [{ title: '打开输出面板' }];
		const result = await Messages.showMessage(
			'error',
			`${message}。详情请查看输出面板`,
			undefined,
			null,
			...actions,
		);

		if (result !== undefined) {
			Logger.showOutputChannel();
		}
		return result;
	}

	static showFileNotUnderSourceControlWarningMessage(message: string): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'warn',
			`${message}。该文件可能未纳入版本控制。`,
			SuppressedMessages.FileNotUnderSourceControlWarning,
		);
	}

	static showGitDisabledErrorMessage() {
		return Messages.showMessage(
			'error',
			'GitLess 需要启用 Git。请将 `git.enabled` 设为 true，然后重新加载窗口。',
			SuppressedMessages.GitDisabledWarning,
		);
	}

	static showGitInvalidConfigErrorMessage() {
		return Messages.showMessage(
			'error',
			'GitLess 无法使用 Git。Git 配置似乎无效，请修复配置后重新加载窗口。',
		);
	}

	static showGitMissingErrorMessage() {
		return Messages.showMessage(
			'error',
			'GitLess 找不到 Git。请确认已安装 Git，且 Git 位于 PATH 中，或已通过 `git.path` 指定安装位置。',
			SuppressedMessages.GitMissingWarning,
		);
	}

	static showGitVersionUnsupportedErrorMessage(version: string, required: string): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'error',
			`GitLess 需要 Git ${required} 或更高版本，当前版本为 ${version}。请升级 Git。`,
			SuppressedMessages.GitVersionWarning,
		);
	}

	static async showIncorrectWorkspaceCasingWarningMessage(): Promise<void> {
		void (await Messages.showMessage(
			'warn',
			'工作区路径的大小写与磁盘上的实际路径不一致。请按磁盘上的准确大小写重新打开工作区，否则可能无法正常显示 Git 逐行追溯或历史记录。',
			SuppressedMessages.IncorrectWorkspaceCasingWarning,
		));
	}

	static showInsidersErrorMessage() {
		return Messages.showMessage(
			'error',
			'无法同时启用 GitLess 的预览版和正式版，请只启用其中一个版本。',
			SuppressedMessages.GitDisabledWarning,
		);
	}

	static showLineUncommittedWarningMessage(message: string): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'warn',
			`${message}。该行有未提交的更改。`,
			SuppressedMessages.LineUncommittedWarning,
		);
	}

	static showNoRepositoryWarningMessage(message: string): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'warn',
			`${message}。找不到仓库。`,
			SuppressedMessages.NoRepositoryWarning,
		);
	}

	static showRebaseSwitchToTextWarningMessage(): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'warn',
			'关闭 git-rebase-todo 文件或变基编辑器后，将开始变基。',
			SuppressedMessages.RebaseSwitchToTextWarning,
		);
	}

	static async showWhatsNewMessage(version: string) {
		const whatsnew = { title: '新版内容' };
		const result = await Messages.showMessage(
			'info',
			`GitLess 已更新至 v${version}，查看新版内容！`,
			undefined,
			null,
			whatsnew,
		);

		if (result === whatsnew) {
			await env.openExternal(Uri.parse('https://gitlens.amod.io/#whats-new'));
		}
	}

	private static async showMessage(
		type: 'info' | 'warn' | 'error',
		message: string,
		suppressionKey?: SuppressedMessages,
		dontShowAgain: MessageItem | null = { title: '不再显示' },
		...actions: MessageItem[]
	): Promise<MessageItem | undefined> {
		Logger.log(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)})`);

		if (suppressionKey !== undefined && configuration.get(`advanced.messages.${suppressionKey}` as const)) {
			Logger.log(
				`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)}) skipped`,
			);
			return undefined;
		}

		if (suppressionKey !== undefined && dontShowAgain !== null) {
			actions.push(dontShowAgain);
		}

		let result: MessageItem | undefined = undefined;
		switch (type) {
			case 'info':
				result = await window.showInformationMessage(message, ...actions);
				break;

			case 'warn':
				result = await window.showWarningMessage(message, ...actions);
				break;

			case 'error':
				result = await window.showErrorMessage(message, ...actions);
				break;
		}

		if ((suppressionKey !== undefined && dontShowAgain === null) || result === dontShowAgain) {
			Logger.log(
				`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(
					dontShowAgain,
				)}) don't show again requested`,
			);
			await this.suppressedMessage(suppressionKey!);

			if (result === dontShowAgain) return undefined;
		}

		Logger.log(
			`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)}) returned ${
				result != null ? result.title : result
			}`,
		);
		return result;
	}

	private static suppressedMessage(suppressionKey: SuppressedMessages) {
		const messages = { ...configuration.get('advanced.messages') };

		messages[suppressionKey] = true;

		for (const [key, value] of Object.entries(messages)) {
			if (value !== true) {
				delete messages[key as keyof typeof messages];
			}
		}

		return configuration.update('advanced.messages', messages, ConfigurationTarget.Global);
	}
}
