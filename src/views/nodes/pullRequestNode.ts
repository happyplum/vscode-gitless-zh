'use strict';
import { ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Colors } from '../../constants';
import { GitBranch, GitCommit, PullRequest, PullRequestState } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { ViewsWithPullRequests } from '../viewBase';
import { RepositoryNode } from './repositoryNode';
import { ContextValues, ViewNode } from './viewNode';

export class PullRequestNode extends ViewNode<ViewsWithPullRequests> {
	static key = ':pullrequest';
	static getId(repoPath: string, id: string, ref: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${id}):${ref}`;
	}

	constructor(
		view: ViewsWithPullRequests,
		parent: ViewNode,
		public readonly pullRequest: PullRequest,
		public readonly branchOrCommit: GitBranch | GitCommit,
	) {
		super(GitUri.fromRepoPath(branchOrCommit.repoPath), view, parent);
	}

	override toClipboard(): string {
		return this.pullRequest.url;
	}

	override get id(): string {
		return PullRequestNode.getId(this.branchOrCommit.repoPath, this.pullRequest.id, this.branchOrCommit.ref);
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(`#${this.pullRequest.id}: ${this.pullRequest.title}`, TreeItemCollapsibleState.None);
		item.id = this.id;
		item.contextValue = ContextValues.PullRequest;
		item.description = `${this.pullRequest.state}, ${this.pullRequest.formatDateFromNow()}`;
		item.iconPath = new ThemeIcon(
			'git-pull-request',
			new ThemeColor(
				this.pullRequest.state === PullRequestState.Closed
					? Colors.ClosedPullRequestIconColor
					: this.pullRequest.state === PullRequestState.Merged
					? Colors.MergedPullRequestIconColor
					: Colors.OpenPullRequestIconColor,
			),
		);
		item.tooltip = `${this.pullRequest.title}\n${this.pullRequest.author.name} 的 #${this.pullRequest.id} ${
			this.pullRequest.state === PullRequestState.Open
				? '已打开'
				: this.pullRequest.state === PullRequestState.Merged
				? '已合并'
				: '已关闭'
		} ${this.pullRequest.formatDateFromNow()}`;

		if (this.branchOrCommit instanceof GitCommit) {
			item.tooltip = `提交 ${this.branchOrCommit.shortSha} 由 PR #${this.pullRequest.id} 引入\n${item.tooltip}`;
		}

		// item.tooltip = `Open Pull Request #${this.pullRequest.number} on ${this.pullRequest.provider}`;
		// item.command = {
		// 	title: 'Open Pull Request',
		// 	command: Commands.OpenPullRequestOnRemote,
		// 	arguments: [this],
		// };

		return item;
	}
}
