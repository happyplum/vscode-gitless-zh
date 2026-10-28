'use strict';
import { commands, Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { WorktreesViewConfig } from '../configuration';
import { Container } from '../container';
import { ViewBase } from './viewBase';
import {
	GitWorktree,
	Repository,
	RepositoryChange,
	RepositoryChangeComparisonMode,
	RepositoryChangeEvent,
} from '../git/git';
import { GitUri } from '../git/gitUri';
import { RepositoryFolderNode, unknownGitUri, ViewNode } from './nodes/viewNode';
import { worktreePathKey, WorktreesNode } from './nodes/worktreesNode';

class WorktreesRepositoryNode extends RepositoryFolderNode<WorktreesView, WorktreesNode> {
	private readonly updatedAt: number[];

	constructor(
		view: WorktreesView,
		parent: ViewNode,
		private readonly repositories: Repository[],
		splatted: boolean,
		worktrees?: GitWorktree[],
	) {
		const repo = repositories[0];
		super(GitUri.fromRepoPath(repo.path), view, parent, repo, splatted);
		this.updatedAt = repositories.map(repository => repository.updatedAt);
		this.child = new WorktreesNode(this.uri, view, this, repo, worktrees);
	}

	async getChildren(): Promise<ViewNode[]> {
		return this.child!.getChildren();
	}

	protected override subscribe(): Disposable {
		return Disposable.from(
			...this.repositories.map(repo =>
				repo.onDidChange(e => {
					if (
						this.changed(e) ||
						e.changed(RepositoryChange.Closed, RepositoryChange.Starred, RepositoryChangeComparisonMode.Any)
					) {
						void this.parent!.triggerChange(true);
					}
				}),
			),
		);
	}

	protected override get requiresResetOnVisible(): boolean {
		return this.repositories.some((repo, index) => repo.updatedAt !== this.updatedAt[index]);
	}

	override async refresh(reset: boolean = false): Promise<void> {
		if (reset) {
			await this.parent!.triggerChange(true);
			return;
		}
		await super.refresh(reset);
	}

	protected changed(e: RepositoryChangeEvent): boolean {
		return e.changed(
			RepositoryChange.Config,
			RepositoryChange.Heads,
			RepositoryChange.Index,
			RepositoryChange.Remotes,
			RepositoryChange.Status,
			RepositoryChange.Tags,
			RepositoryChange.Unknown,
			RepositoryChangeComparisonMode.Any,
		);
	}
}

class WorktreesViewNode extends ViewNode<WorktreesView> {
	protected override splatted = true;
	private children: WorktreesRepositoryNode[] | undefined;

	constructor(view: WorktreesView) {
		super(unknownGitUri, view);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const repositories = await Container.git.getOrderedRepositories();
			this.view.message = repositories.length === 0 ? '找不到仓库。' : undefined;
			const listings = await Promise.allSettled(repositories.map(repo => Container.git.getWorktrees(repo.path)));
			const groups = new Map<string, { repositories: Repository[]; worktrees?: GitWorktree[] }>();
			for (const [index, repo] of repositories.entries()) {
				const listing = listings[index];
				const worktrees = listing.status === 'fulfilled' ? listing.value : undefined;
				const mainPath = worktrees?.find(worktree => worktree.main)?.path;
				const key = mainPath == null ? `repository:${repo.path}` : `worktree:${worktreePathKey(mainPath)}`;
				const group = groups.get(key);
				if (group == null) {
					groups.set(key, { repositories: [repo], worktrees: worktrees });
				} else {
					group.repositories.push(repo);
				}
			}
			this.children = Array.from(
				groups.values(),
				group =>
					new WorktreesRepositoryNode(
						this.view,
						this,
						group.repositories,
						groups.size === 1,
						group.worktrees,
					),
			);
		}
		if (this.children.length === 1) return this.children[0].getChildren();
		return this.children;
	}

	override async getSplattedChild(): Promise<ViewNode | undefined> {
		if (this.children == null) await this.getChildren();
		return this.children?.length === 1 ? this.children[0] : undefined;
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
			commands.registerCommand(
				this.getQualifiedCommand('refresh'),
				async () => {
					await Container.git.resetCaches('branches', 'tags', 'status');
					return this.refresh(true);
				},
				this,
			),
			Container.git.onDidChangeRepositories(() => void this.refresh(true)),
		];
	}
}
