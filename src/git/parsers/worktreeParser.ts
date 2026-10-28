'use strict';

export interface GitWorktree {
	path: string;
	head: string | undefined;
	branch: string | undefined;
	main: boolean;
	bare: boolean;
	detached: boolean;
	locked: string | undefined;
	prunable: string | undefined;
}

// `git worktree list --porcelain -z` separates fields and records with NULs.
export function parseWorktrees(data: string): GitWorktree[] {
	const worktrees: GitWorktree[] = [];
	let current: GitWorktree | undefined;

	for (const field of data.split('\0')) {
		if (field === '') {
			if (current != null) {
				worktrees.push(current);
				current = undefined;
			}
			continue;
		}

		const separator = field.indexOf(' ');
		const key = separator === -1 ? field : field.substring(0, separator);
		const value = separator === -1 ? '' : field.substring(separator + 1);
		if (key === 'worktree') {
			current = {
				path: value,
				head: undefined,
				branch: undefined,
				main: worktrees.length === 0,
				bare: false,
				detached: false,
				locked: undefined,
				prunable: undefined,
			};
		} else if (current != null) {
			switch (key) {
				case 'HEAD':
					current.head = value;
					break;
				case 'branch':
					current.branch = value;
					break;
				case 'bare':
					current.bare = true;
					break;
				case 'detached':
					current.detached = true;
					break;
				case 'locked':
					current.locked = value;
					break;
				case 'prunable':
					current.prunable = value;
					break;
			}
		}
	}

	if (current != null) worktrees.push(current);
	return worktrees;
}
