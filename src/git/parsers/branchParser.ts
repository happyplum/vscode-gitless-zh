'use strict';
import { debug } from '../../system';
import { GitBranch, GitTrackingUpstream } from '../models/branch';

const branchWithTrackingRegex =
	/^<h>(.+)<n>(.+)<u>(.*)<t>(?:\[(?:ahead ([0-9]+))?[,\s]*(?:behind ([0-9]+))?]|\[(gone)])?<r>(.*)<d>(.*)$/gm;

// Using %x00 codes because some shells seem to try to expand things if not
const lb = '%3c'; // `%${'<'.charCodeAt(0).toString(16)}`;
const rb = '%3e'; // `%${'>'.charCodeAt(0).toString(16)}`;

export class GitBranchParser {
	static defaultFormat = [
		`${lb}h${rb}%(HEAD)`, // HEAD indicator
		`${lb}n${rb}%(refname)`, // branch name
		`${lb}u${rb}%(upstream)`, // full ref distinguishes local upstreams from remote tracking refs
		`${lb}t${rb}%(upstream:track)`, // branch upstream tracking state
		`${lb}r${rb}%(objectname)`, // ref
		`${lb}d${rb}%(committerdate:iso8601)`, // committer date
	].join('');

	@debug({ args: false, singleLine: true })
	static parse(data: string, repoPath: string, config?: string, remotes: readonly string[] = []): GitBranch[] {
		const branches: GitBranch[] = [];

		if (!data) return branches;

		let current;
		let name;
		let upstream;
		let ahead;
		let behind;
		let missing;
		let ref;
		let date;

		let remote;

		let match;
		do {
			match = branchWithTrackingRegex.exec(data);
			if (match == null) break;

			[, current, name, upstream, ahead, behind, missing, ref, date] = match;

			if (name.startsWith('refs/remotes/')) {
				// Strip off refs/remotes/
				name = name.substr(13);
				if (name.endsWith('/HEAD')) continue;

				remote = true;
			} else {
				// Strip off refs/heads/
				name = name.substr(11);
				remote = false;
			}

			branches.push(
				new GitBranch(
					repoPath,
					name,
					remote,
					current.charCodeAt(0) === 42, // '*',
					new Date(date),
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					ref == null || ref.length === 0 ? undefined : ` ${ref}`.substr(1),
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					this.parseUpstream(name, upstream, Boolean(missing), config),
					Number(ahead) || 0,
					Number(behind) || 0,
					undefined,
					undefined,
					remote ? this.getRemoteName(name, remotes) : undefined,
				),
			);
		} while (true);

		return branches;
	}

	private static getRemoteName(name: string, remotes: readonly string[]): string | undefined {
		const matches = remotes.filter(remote => name.startsWith(`${remote}/`));
		return matches.length === 1 ? matches[0] : undefined;
	}

	static parseUpstream(
		branch: string,
		ref: string | undefined,
		missing: boolean,
		config?: string,
	): GitTrackingUpstream | undefined {
		let remote;
		let merge;
		for (const line of config?.split('\n') ?? []) {
			const separator = line.search(/\s/);
			const key = line.substring(0, separator);
			if (key === `branch.${branch}.remote`) remote = line.substring(separator + 1).trim();
			if (key === `branch.${branch}.merge`) merge = line.substring(separator + 1).trim();
		}

		const local = remote === '.' || (remote == null && ref?.startsWith('refs/heads/') === true);
		const remoteBranch = remote != null && remote !== '.' ? merge?.replace(/^refs\/heads\//, '') : undefined;
		const name =
			ref?.replace(/^refs\/(?:heads|remotes)\//, '') ||
			(merge != null
				? local
					? merge.replace(/^refs\/heads\//, '')
					: remote != null
					? `${remote}/${remoteBranch}`
					: undefined
				: undefined);
		if (!name) return undefined;

		return {
			name: ` ${name}`.substr(1),
			missing: missing,
			local: local,
			remote: remote !== '.' ? remote : undefined,
			remoteBranch: remoteBranch,
		};
	}
}
