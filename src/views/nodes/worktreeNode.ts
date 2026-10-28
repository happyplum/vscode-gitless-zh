'use strict';
import * as paths from 'path';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri, window } from 'vscode';
import { Commands } from '../../commands/common';
import { Container } from '../../container';
import { GitBranch, GitLog, GitStatus, GitWorktree, Repository } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { RepositoriesView } from '../repositoriesView';
import { WorktreesView } from '../worktreesView';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { insertDateMarkers } from './helpers';
import { ContextValues, PageableViewNode, ViewNode } from './viewNode';

export class WorktreeNode extends ViewNode<RepositoriesView | WorktreesView> implements PageableViewNode {
	private _children: ViewNode[] | undefined;
	private _log: GitLog | undefined;
	private _status: Promise<{ branch: GitBranch | undefined; status: GitStatus | undefined }> | undefined;
	limit: number | undefined = this.view.getNodeLastKnownLimit(this);

	constructor(
		view: RepositoriesView | WorktreesView,
		parent: ViewNode,
		public readonly repo: Repository,
		public readonly worktree: GitWorktree,
		private readonly current: boolean = false,
	) {
		super(GitUri.fromRepoPath(worktree.path), view, parent);
	}

	override get id(): string {
		return `gitlens:worktree(${this.repo.path}:${this.worktree.path})`;
	}

	override toClipboard(): string {
		return this.worktree.path;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const log = await this.getLog();
			if (log == null || log.commits.size === 0) {
				this._children = [new MessageNode(this.view, this, '未找到提交')];
			} else {
				const { branch } = await this.getStatus();
				const range =
					branch != null && !branch.detached ? await Container.git.getBranchAheadRange(branch) : undefined;
				const [getBranchAndTagTips, unpublishedCommits] = await Promise.all([
					Container.git.getBranchesAndTagsTipsFn(this.repo.path, branch?.name),
					range ? Container.git.getLogRefsOnly(branch!.repoPath, { ref: range, limit: 0 }) : undefined,
				]);
				this._children = [
					...insertDateMarkers(
						Array.from(
							log.commits.values(),
							commit =>
								new CommitNode(
									this.view,
									this,
									commit,
									unpublishedCommits?.has(commit.ref),
									undefined,
									getBranchAndTagTips,
								),
						),
						this,
					),
				];
				if (log.hasMore) {
					this._children.push(new LoadMoreNode(this.view, this, this._children[this._children.length - 1]));
				}
			}
		}
		return this._children;
	}

	private getStatus() {
		if (this._status == null) {
			// Bare and prunable entries do not have a usable working directory.
			this._status =
				this.worktree.bare || this.worktree.prunable != null
					? Promise.resolve({ branch: undefined, status: undefined })
					: Promise.allSettled([
							Container.git.getBranch(this.worktree.path),
							Container.git.getStatusForRepo(this.worktree.path),
						]).then(([branch, status]) => ({
							branch: branch.status === 'fulfilled' ? branch.value : undefined,
							status: status.status === 'fulfilled' ? status.value : undefined,
						}));
		}
		return this._status;
	}

	private async getLog(): Promise<GitLog | undefined> {
		const head = this.worktree.head;
		if (head == null || /^0+$/.test(head)) return undefined;
		if (this._log == null) {
			this._log = await Container.git.getLog(this.repo.path, {
				ref: head,
				limit: this.limit ?? this.view.config.defaultItemLimit,
			});
		}
		return this._log;
	}

	get hasMore(): boolean {
		return this._log?.hasMore ?? this.worktree.head != null;
	}

	async loadMore(limit?: number | { until?: string }): Promise<void> {
		let log = await window.withProgress({ location: { viewId: this.view.id } }, () => this.getLog());
		if (!log?.hasMore) return;
		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;
		this._log = log;
		this.limit = log?.count;
		this._children = undefined;
		void this.triggerChange(false);
	}

	override refresh(reset: boolean = false): void {
		this._children = undefined;
		this._status = undefined;
		if (reset) this._log = undefined;
	}

	async getTreeItem(): Promise<TreeItem> {
		const { worktree } = this;
		const { branch, status } = await this.getStatus();
		const branchName =
			branch?.detached || worktree.detached
				? '分离 HEAD'
				: (branch?.name ?? worktree.branch?.replace(/^refs\/heads\//, '') ?? '裸仓库');
		const tracking =
			branch != null && !branch.detached && !branch.upstream?.missing ? branch.getTrackingStatus() : '';
		const description = [tracking, status?.files.length ? `${status.files.length} 个文件` : '', branchName].filter(
			Boolean,
		);
		if (this.current) description.push('当前工作树');
		if (worktree.main) description.push('主工作树');
		if (worktree.locked != null) description.push('已锁定');
		if (worktree.prunable != null) description.push('可清理');
		const tooltip = [worktree.path, branchName];
		if (this.current) tooltip.push('此工作树已在当前窗口打开');
		if (worktree.head) tooltip.push(`HEAD ${worktree.head}`);
		if (branch != null && !branch.detached) {
			tooltip.push(
				branch.upstream == null
					? '未设置上游分支'
					: branch.upstream.missing
						? `上游分支已丢失：${branch.upstream.name}`
						: `${branch.getTrackingStatus({ expand: true, separator: '，' }) || '已同步'}（相对于 ${branch.upstream.name}）`,
			);
		}
		if (!worktree.bare && worktree.prunable == null) {
			tooltip.push(
				status == null
					? '工作区状态不可用'
					: status.files.length === 0
						? '工作区干净，无未提交更改'
						: `${status.files.length} 个文件有未提交更改（含已暂存、未暂存和未跟踪文件，同一文件只计一次）`,
			);
		}
		if (worktree.locked != null) tooltip.push(`锁定：${worktree.locked}`);
		if (worktree.prunable != null) tooltip.push(`可清理：${worktree.prunable}`);
		const openOnClick = this.view.id === 'gitlens.views.repositories';
		const item = new TreeItem(
			paths.basename(worktree.path),
			openOnClick ? TreeItemCollapsibleState.None : TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.description = description.join(' · ');
		item.tooltip = tooltip.join('\n');
		item.contextValue = `${ContextValues.Worktree}${worktree.main ? '+main' : ''}${worktree.locked != null ? '+locked' : ''}${worktree.prunable != null ? '+prunable' : ''}`;
		item.iconPath = new ThemeIcon(worktree.locked != null ? 'lock' : 'repo');
		if (branch != null && !branch.detached) {
			item.resourceUri = Uri.parse(`gitlens-view://branch/status/${await branch.getStatus()}`);
		}
		if (openOnClick) item.command = { command: Commands.WorktreeOpen, title: '打开工作树', arguments: [this] };
		return item;
	}
}
