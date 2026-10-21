'use strict';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitBranchReference, GitReference, Repository } from '../../git/git';
import { FlagsQuickPickItem } from '../../quickpicks';
import { Arrays, Dates, Strings } from '../../system';
import {
	appendReposToTitle,
	AsyncStepResultGenerator,
	PartialStepState,
	pickRepositoriesStep,
	QuickCommand,
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

type Flags = '--all' | '--prune';

interface State {
	repos: string | string[] | Repository | Repository[];
	reference?: GitBranchReference;
	flags: Flags[];
}

export interface FetchGitCommandArgs {
	readonly command: 'fetch';
	confirm?: boolean;
	state?: Partial<State>;
}

type FetchStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repos', string | string[] | Repository>;

export class FetchGitCommand extends QuickCommand<State> {
	constructor(args?: FetchGitCommandArgs) {
		super('fetch', 'fetch', '抓取', { description: '从一个或多个远程仓库抓取更改' });

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

	execute(state: FetchStepState) {
		if (GitReference.isBranch(state.reference)) {
			return state.repos[0].fetch({ branch: state.reference });
		}

		return Container.git.fetchAll(state.repos, {
			all: state.flags.includes('--all'),
			prune: state.flags.includes('--prune'),
		});
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
				const result = yield* this.confirmStep(state as FetchStepState, context);
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
			void this.execute(state as FetchStepState);
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private async *confirmStep(state: FetchStepState, context: Context): AsyncStepResultGenerator<Flags[]> {
		let lastFetchedOn = '';
		if (state.repos.length === 1) {
			const lastFetched = await state.repos[0].getLastFetched();
			if (lastFetched !== 0) {
				lastFetchedOn = `${Strings.pad(GlyphChars.Dot, 2, 2)}Last fetched ${Dates.getFormatter(
					new Date(lastFetched),
				).fromNow()}`;
			}
		}

		let step: QuickPickStep<FlagsQuickPickItem<Flags>>;

		if (state.repos.length === 1 && GitReference.isBranch(state.reference)) {
			step = this.createConfirmStep(
				appendReposToTitle(`Confirm ${context.title}`, state, context, lastFetchedOn),
				[
					FlagsQuickPickItem.create<Flags>(state.flags, [], {
						label: this.title,
						detail: `将抓取 ${GitReference.toString(state.reference)}`,
					}),
				],
			);
		} else {
			const reposToFetch =
				state.repos.length === 1
					? `$(repo) ${state.repos[0].formattedName}`
					: `${state.repos.length} repositories`;

			step = QuickCommand.createConfirmStep(
				appendReposToTitle(`Confirm ${this.title}`, state, context, lastFetchedOn),
				[
					FlagsQuickPickItem.create<Flags>(state.flags, [], {
						label: this.title,
						detail: `将抓取 ${reposToFetch}`,
					}),
					FlagsQuickPickItem.create<Flags>(state.flags, ['--prune'], {
						label: `${this.title} & 清理失效引用`,
						description: '--prune',
						detail: `将抓取并清理失效引用 ${reposToFetch}`,
					}),
					FlagsQuickPickItem.create<Flags>(state.flags, ['--all'], {
						label: `${this.title} 全部`,
						description: '--all',
						detail: `将抓取 ${reposToFetch} 的所有远程仓库`,
					}),
					FlagsQuickPickItem.create<Flags>(state.flags, ['--all', '--prune'], {
						label: `${this.title} 全部 & 清理失效引用`,
						description: '--all --prune',
						detail: `将抓取并清理失效引用 ${reposToFetch} 的所有远程仓库`,
					}),
				],
				context,
			);
		}

		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}
