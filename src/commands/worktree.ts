'use strict';
import * as paths from 'path';
import { commands, window } from 'vscode';
import { command, Command, CommandContext, Commands, openWorktree } from './common';
import { Container } from '../container';
import { Git, GitWorktree, Repository } from '../git/git';
import { RepositoryNode, WorktreeNode, WorktreesNode } from '../views/nodes';

type WorktreeContextNode = RepositoryNode | WorktreesNode | WorktreeNode;

@command()
export class WorktreeCommand extends Command {
	constructor() {
		super([
			Commands.WorktreeCreate,
			Commands.WorktreeOpen,
			Commands.WorktreeRemove,
			Commands.WorktreeLock,
			Commands.WorktreeUnlock,
		]);
	}

	protected override preExecute(context: CommandContext) {
		const node = context.type === 'viewItem' && (
			context.node instanceof RepositoryNode ||
			context.node instanceof WorktreesNode ||
			context.node instanceof WorktreeNode
		) ? context.node : undefined;
		return this.execute(context.command as Commands, node);
	}

	async execute(action: Commands, node?: WorktreeContextNode): Promise<void> {
		const repo = node?.repo ?? await this.pickRepository();
		if (repo == null) return;

		try {
			switch (action) {
				case Commands.WorktreeCreate:
					await this.create(repo);
					return;
				case Commands.WorktreeOpen:
				case Commands.WorktreeRemove:
				case Commands.WorktreeLock:
				case Commands.WorktreeUnlock: {
					const worktree = await this.pickWorktree(repo, node instanceof WorktreeNode ? node.worktree.path : undefined);
					if (worktree == null) return;
					if (action === Commands.WorktreeOpen) {
						await openWorktree(worktree.path);
					} else if (action === Commands.WorktreeRemove) {
						await this.remove(repo, worktree);
					} else if (action === Commands.WorktreeLock) {
						await this.lock(repo, worktree);
					} else {
						await this.unlock(repo, worktree);
					}
				}
			}
		} catch (ex) {
			void window.showErrorMessage(`工作树操作失败：${String(ex)}`);
		}
	}

	private async pickRepository(): Promise<Repository | undefined> {
		const repos = await Container.git.getOrderedRepositories();
		if (repos.length === 0) {
			void window.showInformationMessage('没有可用的 Git 仓库');
			return undefined;
		}
		if (repos.length === 1) return repos[0];
		const choice = await window.showQuickPick(
			repos.map(repo => ({ label: repo.formattedName, description: repo.path, repo: repo })),
			{ placeHolder: '选择仓库' },
		);
		return choice?.repo;
	}

	private async pickWorktree(repo: Repository, selectedPath?: string): Promise<GitWorktree | undefined> {
		const worktrees = await Container.git.getWorktrees(repo.path);
		if (selectedPath != null) {
			const current = worktrees.find(w => w.path === selectedPath);
			if (current == null) void window.showErrorMessage(`工作树已不存在：${selectedPath}`);
			return current;
		}
		const choice = await window.showQuickPick(
			worktrees.map(worktree => ({
				label: worktree.branch?.replace(/^refs\/heads\//, '') ?? worktree.path,
				description: worktree.path,
				worktree: worktree,
			})),
			{ placeHolder: '选择工作树' },
		);
		return choice?.worktree;
	}

	private async create(repo: Repository): Promise<void> {
		const branches = await repo.getBranches({ filter: b => !b.remote, sort: true });
		if (branches.length === 0) {
			void window.showErrorMessage('仓库中没有可用的本地分支');
			return;
		}
		const mode = await window.showQuickPick(
			[
				{ label: '使用已有本地分支', value: 'existing' },
				{ label: '创建新分支', value: 'new' },
			],
			{ placeHolder: '选择工作树的分支方式' },
		);
		if (mode == null) return;
		const selected = await window.showQuickPick(
			branches.map(branch => ({ label: branch.name, branch: branch })),
			{ placeHolder: mode.value === 'new' ? '选择新分支的起点' : '选择要签出的本地分支' },
		);
		if (selected == null) return;

		let newBranch: string | undefined;
		if (mode.value === 'existing') {
			const occupied = (await Container.git.getWorktrees(repo.path)).find(
				w => w.branch === `refs/heads/${selected.branch.name}`,
			);
			if (occupied != null) {
				await openWorktree(occupied.path, { branch: selected.branch.name });
				return;
			}
		} else {
			newBranch = await window.showInputBox({
				prompt: '输入新分支名',
				validateInput: async value => {
					if (!(await Git.check_ref_format(value, repo.path))) return '无效的分支名';
					if (branches.some(b => b.name === value)) return '分支已存在';
					return undefined;
				},
			});
			if (newBranch == null) return;
		}

		const parent = await window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: '选择工作树的父目录',
		});
		if (parent == null || parent.length === 0) return;
		const folder = await window.showInputBox({
			prompt: '输入新工作树的文件夹名',
			validateInput: value =>
				!value || value === '.' || value === '..' || /[\\/:]/.test(value) ? '请输入单个文件夹名' : undefined,
		});
		if (folder == null) return;
		const path = paths.join(parent[0].fsPath, folder);
		await Container.git.addWorktree(repo.path, path, selected.branch.name, newBranch);
		await this.refresh();
		await openWorktree(path);
	}

	private async remove(repo: Repository, worktree: GitWorktree): Promise<void> {
		if (worktree.main || paths.normalize(worktree.path) === paths.normalize(repo.path)) {
			void window.showErrorMessage('不能移除主工作树或当前打开的工作树');
			return;
		}
		const branch = worktree.branch?.replace(/^refs\/heads\//, '') ?? '分离 HEAD';
		const choice = await window.showWarningMessage(
			`删除工作树目录 ${worktree.path}？分支 ${branch} 将保留。Git 会拒绝删除含未提交更改或已锁定的工作树。`,
			{ modal: true },
			'删除工作树',
		);
		if (choice !== '删除工作树') return;
		await Container.git.removeWorktree(repo.path, worktree.path);
		await this.refresh();
	}

	private async lock(repo: Repository, worktree: GitWorktree): Promise<void> {
		if (worktree.main || worktree.locked != null) return;
		const reason = await window.showInputBox({ prompt: `锁定工作树 ${worktree.path}；可选填原因` });
		if (reason == null) return;
		await Container.git.lockWorktree(repo.path, worktree.path, reason);
		await this.refresh();
	}

	private async unlock(repo: Repository, worktree: GitWorktree): Promise<void> {
		if (worktree.main || worktree.locked == null) return;
		await Container.git.unlockWorktree(repo.path, worktree.path);
		await this.refresh();
	}

	private async refresh(): Promise<void> {
		await commands.executeCommand('gitlens.views.repositories.refresh');
	}
}
