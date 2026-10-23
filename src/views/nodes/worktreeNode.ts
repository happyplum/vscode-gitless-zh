'use strict';
import * as paths from 'path';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands } from '../../commands/common';
import { GitWorktree, Repository } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { RepositoriesView } from '../repositoriesView';
import { ContextValues, ViewNode } from './viewNode';

export class WorktreeNode extends ViewNode<RepositoriesView> {
	constructor(
		view: RepositoriesView,
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

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const { worktree } = this;
		const branch = worktree.branch?.replace(/^refs\/heads\//, '') ?? (worktree.detached ? '分离 HEAD' : '裸仓库');
		const item = new TreeItem(paths.basename(worktree.path), TreeItemCollapsibleState.None);
		item.id = this.id;
		item.description = `${branch}${worktree.main ? ' · 主工作树' : ''}${worktree.locked != null ? ' · 已锁定' : ''}${worktree.prunable != null ? ' · 可清理' : ''}`;
		item.tooltip = `${worktree.path}\n${branch}${worktree.head ? `\nHEAD ${worktree.head}` : ''}${worktree.locked != null ? `\n锁定：${worktree.locked}` : ''}${worktree.prunable != null ? `\n可清理：${worktree.prunable}` : ''}`;
		item.contextValue = `${ContextValues.Worktree}${worktree.main ? '+main' : ''}${worktree.locked != null ? '+locked' : ''}${worktree.prunable != null ? '+prunable' : ''}`;
		item.iconPath = new ThemeIcon(worktree.locked != null ? 'lock' : 'repo');
		item.command = { command: Commands.WorktreeOpen, title: '打开工作树', arguments: [this] };
		return item;
	}
}
