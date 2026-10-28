'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { Repository } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { RepositoriesView } from '../repositoriesView';
import { WorktreesView } from '../worktreesView';
import { MessageNode } from './common';
import { RepositoryNode } from './repositoryNode';
import { ContextValues, ViewNode } from './viewNode';
import { WorktreeNode } from './worktreeNode';

export class WorktreesNode extends ViewNode<RepositoriesView | WorktreesView> {
	static key = ':worktrees';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	private _children: ViewNode[] | undefined;

	constructor(uri: GitUri, view: RepositoriesView | WorktreesView, parent: ViewNode, public readonly repo: Repository) {
		super(uri, view, parent);
	}

	override get id(): string {
		return WorktreesNode.getId(this.repo.path);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			try {
				const worktrees = await Container.git.getWorktrees(this.repo.path);
				this._children = worktrees.map(w => new WorktreeNode(this.view, this, this.repo, w));
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
		this._children = undefined;
	}
}
