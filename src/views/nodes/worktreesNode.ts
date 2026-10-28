'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitWorktree, Repository } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { isWindows } from '../../git/shell';
import { Strings } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { WorktreesView } from '../worktreesView';
import { MessageNode } from './common';
import { RepositoryNode } from './repositoryNode';
import { ContextValues, ViewNode } from './viewNode';
import { WorktreeNode } from './worktreeNode';

export function worktreePathKey(path: string): string {
	const normalized = Strings.normalizePath(path);
	return isWindows ? normalized.toLowerCase() : normalized;
}

export class WorktreesNode extends ViewNode<RepositoriesView | WorktreesView> {
	static key = ':worktrees';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	private _children: ViewNode[] | undefined;

	constructor(
		uri: GitUri,
		view: RepositoriesView | WorktreesView,
		parent: ViewNode,
		public readonly repo: Repository,
		private initialWorktrees?: GitWorktree[],
	) {
		super(uri, view, parent);
		this.splatted = view.id === 'gitlens.views.worktrees';
	}

	override get id(): string {
		return WorktreesNode.getId(this.repo.path);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			try {
				const worktrees = this.initialWorktrees ?? (await Container.git.getWorktrees(this.repo.path));
				this.initialWorktrees = undefined;
				const repositories = await Container.git.getOrderedRepositories();
				const currentPaths = new Set(repositories.map(repo => worktreePathKey(repo.path)));
				this._children = worktrees.map(
					w => new WorktreeNode(this.view, this, this.repo, w, currentPaths.has(worktreePathKey(w.path))),
				);
			} catch (ex) {
				return [new MessageNode(this.view, this, String(ex))];
			}
		}
		return this._children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('工作树', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Worktrees;
		item.iconPath = new ThemeIcon('multiple-windows');
		return item;
	}

	override refresh(): void {
		this.initialWorktrees = undefined;
		this._children = undefined;
	}
}
