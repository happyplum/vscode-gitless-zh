'use strict';
import { commands, Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { WorktreesViewConfig } from '../configuration';
import { Container } from '../container';
import { ViewBase } from './viewBase';
import { RepositoryChange, RepositoryChangeComparisonMode, RepositoryChangeEvent } from '../git/git';
import { GitUri } from '../git/gitUri';
import { RepositoryFolderNode, unknownGitUri, ViewNode } from './nodes/viewNode';
import { WorktreesNode } from './nodes/worktreesNode';

class WorktreesRepositoryNode extends RepositoryFolderNode<WorktreesView, WorktreesNode> {
	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			this.child = new WorktreesNode(this.uri, this.view, this, this.repo);
		}
		return this.child.getChildren();
	}

	protected changed(e: RepositoryChangeEvent): boolean {
		return e.changed(
			RepositoryChange.Heads,
			RepositoryChange.Index,
			RepositoryChange.Status,
			RepositoryChange.Unknown,
			RepositoryChangeComparisonMode.Any,
		);
	}
}

class WorktreesViewNode extends ViewNode<WorktreesView> {
	private children: WorktreesRepositoryNode[] | undefined;

	constructor(view: WorktreesView) {
		super(unknownGitUri, view);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const repositories = await Container.git.getOrderedRepositories();
			this.view.message = repositories.length === 0 ? '找不到仓库。' : undefined;
			this.children = repositories.map(
				repo => new WorktreesRepositoryNode(GitUri.fromRepoPath(repo.path), this.view, this, repo, false),
			);
		}
		return this.children;
	}

	getTreeItem(): TreeItem {
		return new TreeItem('工作树', TreeItemCollapsibleState.Expanded);
	}

	override refresh(reset: boolean = false): void {
		if (!reset) return;
		for (const child of this.children ?? []) child.dispose();
		this.children = undefined;
	}
}

export class WorktreesView extends ViewBase<WorktreesViewNode, WorktreesViewConfig> {
	protected readonly configKey = 'worktrees';

	constructor() {
		super('gitlens.views.worktrees', '工作树');
	}

	getRoot(): WorktreesViewNode {
		return new WorktreesViewNode(this);
	}

	protected registerCommands(): Disposable[] {
		void Container.viewCommands;
		return [
			commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this),
			Container.git.onDidChangeRepositories(() => void this.refresh(true)),
		];
	}
}
