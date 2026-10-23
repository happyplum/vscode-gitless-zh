'use strict';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitBranch, GitBranchReference, GitReference, Repository } from '../../git/git';
import { Directive, DirectiveQuickPickItem, FlagsQuickPickItem } from '../../quickpicks';
import { Arrays, Dates, Strings } from '../../system';
import {
	appendReposToTitle,
	AsyncStepResultGenerator,
	PartialStepState,
	pickRepositoriesStep,
	QuickCommand,
	QuickCommandButtons,
	QuickPickStep,
	StepGenerator,
	StepResult,
	StepSelection,
	StepState,
} from '../quickCommand';

interface Context {
	repos: Repository[];
	title: string;
}

type Flags = '--rebase';

interface State {
	repos: string | string[] | Repository | Repository[];
	reference?: GitBranchReference;
	flags: Flags[];
}

export interface PullGitCommandArgs {
	readonly command: 'pull';
	confirm?: boolean;
	state?: Partial<State>;
}

type PullStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repos', string | string[] | Repository>;

export class PullGitCommand extends QuickCommand<State> {
	constructor(args?: PullGitCommandArgs) {
		super('pull', 'pull', '拉取', {
			description: '从远程获取更改并将其集成到当前分支中',
		});

		let counter = 0;
		if (args?.state?.repos != null && (!Array.isArray(args.state.repos) || args.state.repos.length !== 0)) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: args?.confirm,
			...args?.state,
		};
	}

	async execute(state: PullStepState) {
		if (GitReference.isBranch(state.reference)) {
			// Only resort to a branch fetch if the branch isn't the current one
			if (!GitBranch.is(state.reference) || !state.reference.current) {
				const currentBranch = await state.repos[0].getBranch();
				if (currentBranch?.name !== state.reference.name) {
					return state.repos[0].fetch({ branch: state.reference, pull: true });
				}
			}
		}

		return Container.git.pullAll(state.repos, { rebase: state.flags.includes('--rebase') });
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: [...(await Container.git.getOrderedRepositories())],
			title: this.title,
		};

		if (state.flags == null) {
			state.flags = [];
		}

		if (state.repos != null && !Array.isArray(state.repos)) {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- The assignment must preserve the string-or-repository input union.
			state.repos = [state.repos as any];
		}

		let skippedStepOne = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (
				state.counter < 1 ||
				state.repos == null ||
				state.repos.length === 0 ||
				Arrays.isStringArray(state.repos)
			) {
				skippedStepOne = false;
				if (context.repos.length === 1) {
					skippedStepOne = true;
					state.counter++;

					state.repos = [context.repos[0]];
				} else {
					const result = yield* pickRepositoriesStep(
						state as ExcludeSome<typeof state, 'repos', string | Repository>,
						context,
						{ skipIfPossible: state.counter >= 1 },
					);
					// Always break on the first step (so we will go back)
					if (result === StepResult.Break) break;

					state.repos = result;
				}
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.confirmStep(state as PullStepState, context);
				if (result === StepResult.Break) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				state.flags = result;
			}

			QuickCommand.endSteps(state);
			void this.execute(state as PullStepState);
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private async *confirmStep(state: PullStepState, context: Context): AsyncStepResultGenerator<Flags[]> {
		let step: QuickPickStep<FlagsQuickPickItem<Flags>>;

		if (state.repos.length > 1) {
			step = this.createConfirmStep(appendReposToTitle(`确认${context.title}`, state, context), [
				FlagsQuickPickItem.create<Flags>(state.flags, [], {
					label: this.title,
					detail: `将拉取 ${state.repos.length} 仓库`,
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--rebase'], {
					label: `${this.title}并 Rebase`,
					description: '--rebase',
					detail: `将通过 Rebase 来拉取 ${state.repos.length} 仓库`,
				}),
			]);
		} else if (GitReference.isBranch(state.reference)) {
			if (state.reference.remote) {
				step = this.createConfirmStep(
					appendReposToTitle(`确认${context.title}`, state, context),
					[],
					DirectiveQuickPickItem.create(Directive.Cancel, true, {
						label: `取消${this.title}`,
						detail: '无法拉取远程分支',
					}),
				);
			} else {
				const [repo] = state.repos;
				const branch = await repo.getBranch(state.reference.name);

				if (branch != null && !branch.current && (await branch.getRemote()) == null) {
					step = this.createConfirmStep(
						appendReposToTitle(`确认${context.title}`, state, context),
						[],
						DirectiveQuickPickItem.create(Directive.Cancel, true, {
							label: `取消${this.title}`,
							detail: '无法拉取；分支未关联有效的远程仓库',
						}),
					);
				} else if (branch?.upstream == null) {
					step = this.createConfirmStep(
						appendReposToTitle(`确认${context.title}`, state, context),
						[],
						DirectiveQuickPickItem.create(Directive.Cancel, true, {
							label: `取消${this.title}`,
							detail: '在发布分支之前无法拉取分支',
						}),
					);
				} else {
					step = this.createConfirmStep(appendReposToTitle(`确认${context.title}`, state, context), [
						FlagsQuickPickItem.create<Flags>(state.flags, [], {
							label: this.title,
							detail: `将${branch.state.behind ? ` ${branch.state.behind} 个提交` : '更改'}拉取到 ${GitReference.toString(
								branch,
							)}`,
						}),
					]);
				}
			}
		} else {
			const [repo] = state.repos;
			const [status, lastFetched] = await Promise.all([repo.getStatus(), repo.getLastFetched()]);

			let lastFetchedOn = '';
			if (lastFetched !== 0) {
				lastFetchedOn = `${Strings.pad(GlyphChars.Dot, 2, 2)}上次获取：${Dates.getFormatter(
					new Date(lastFetched),
				).fromNow()}`;
			}

			const pullDetails =
				status?.state.behind != null
					? ` ${status.state.behind} 个提交到 $(repo) ${repo.formattedName}`
					: ` 到 $(repo) ${repo.formattedName}`;

			step = this.createConfirmStep(
				appendReposToTitle(`确认${context.title}`, state, context, lastFetchedOn),
				[
					FlagsQuickPickItem.create<Flags>(state.flags, [], {
						label: this.title,
						detail: `将拉取${pullDetails}`,
					}),
					FlagsQuickPickItem.create<Flags>(state.flags, ['--rebase'], {
						label: `${this.title}并 Rebase`,
						description: '--rebase',
						detail: `将拉取并 Rebase${pullDetails}`,
					}),
				],
				undefined,
				{
					additionalButtons: [QuickCommandButtons.Fetch],
					onDidClickButton: async (quickpick, button) => {
						if (button !== QuickCommandButtons.Fetch || quickpick.busy) return false;

						quickpick.title = `确认${context.title}${Strings.pad(GlyphChars.Dot, 2, 2)}抓取${GlyphChars.Ellipsis}`;

						quickpick.busy = true;
						quickpick.enabled = false;
						try {
							await repo.fetch({ progress: true });
							// Signal that the step should be retried
							return true;
						} finally {
							quickpick.busy = false;
							quickpick.enabled = true;
						}
					},
				},
			);
		}

		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}
