'use strict';
import * as paths from 'path';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { Commands } from '../../commands/common';
import { Container } from '../../container';
import { GitLog, GitWorktree, Repository } from '../../git/git';
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
	limit: number | undefined = this.view.getNodeLastKnownLimit(this);

	constructor(
		view: RepositoriesView | WorktreesView,
		parent: ViewNode,
		public readonly repo: Repository,
		public readonly worktree: GitWorktree,
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
				this._children = [
					...insertDateMarkers(
						Array.from(log.commits.values(), commit => new CommitNode(this.view, this, commit)),
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
		if (reset) this._log = undefined;
	}

	getTreeItem(): TreeItem {
		const { worktree } = this;
		const branch = worktree.branch?.replace(/^refs\/heads\//, '') ?? (worktree.detached ? '分离 HEAD' : '裸仓库');
		const openOnClick = this.view.id === 'gitlens.views.repositories';
		const item = new TreeItem(
			paths.basename(worktree.path),
			openOnClick ? TreeItemCollapsibleState.None : TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.description = `${branch}${worktree.main ? ' · 主工作树' : ''}${worktree.locked != null ? ' · 已锁定' : ''}${worktree.prunable != null ? ' · 可清理' : ''}`;
		item.tooltip = `${worktree.path}\n${branch}${worktree.head ? `\nHEAD ${worktree.head}` : ''}${worktree.locked != null ? `\n锁定：${worktree.locked}` : ''}${worktree.prunable != null ? `\n可清理：${worktree.prunable}` : ''}`;
		item.contextValue = `${ContextValues.Worktree}${worktree.main ? '+main' : ''}${worktree.locked != null ? '+locked' : ''}${worktree.prunable != null ? '+prunable' : ''}`;
		item.iconPath = new ThemeIcon(worktree.locked != null ? 'lock' : 'repo');
		if (openOnClick) item.command = { command: Commands.WorktreeOpen, title: '打开工作树', arguments: [this] };
		return item;
	}
}
