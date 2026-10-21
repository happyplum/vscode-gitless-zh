'use strict';
import { configuration } from '../../configuration';
import { BuiltInGitConfiguration, GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitBranchReference, GitReference, Repository } from '../../git/git';
import { Directive, DirectiveQuickPickItem, FlagsQuickPickItem } from '../../quickpicks';
import { Arrays, Dates, Strings } from '../../system';
import {
	appendReposToTitle,
	AsyncStepResultGenerator,
	PartialStepState,
	pickRepositoriesStep,
	pickRepositoryStep,
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

type Flags = '--force' | '--set-upstream' | string;

interface State<Repos = string | string[] | Repository | Repository[]> {
	repos: Repos;
	reference?: GitReference;
	flags: Flags[];
}

export interface PushGitCommandArgs {
	readonly command: 'push';
	confirm?: boolean;
	state?: Partial<State>;
}

type PushStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repos', string | string[] | Repository>;

export class PushGitCommand extends QuickCommand<State> {
	constructor(args?: PushGitCommandArgs) {
		super('push', 'push', '推送', {
			description: '将更改从当前分支推送到远程',
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

	execute(state: State<Repository[]>) {
		const index = state.flags.indexOf('--set-upstream');
		if (index !== -1) {
			if (!GitReference.isBranch(state.reference)) return Promise.resolve();

			return Container.git.pushAll(state.repos, {
				force: false,
				publish: { remote: state.flags[index + 1] },
				reference: state.reference,
			});
		}

		return Container.git.pushAll(state.repos, {
			force: state.flags.includes('--force'),
			reference: state.reference,
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
				} else if (state.reference != null) {
					const result = yield* pickRepositoryStep(
						{ ...state, repos: undefined, repo: state.reference.repoPath },
						context,
					);
					// Always break on the first step (so we will go back)
					if (result === StepResult.Break) break;

					state.repos = [result];
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
				const result = yield* this.confirmStep(state as PushStepState, context);
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
			void this.execute(state as State<Repository[]>);
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private async *confirmStep(state: PushStepState, context: Context): AsyncStepResultGenerator<Flags[]> {
		const useForceWithLease = configuration.getAny<boolean>(BuiltInGitConfiguration.UseForcePushWithLease) ?? false;

		let step: QuickPickStep<FlagsQuickPickItem<Flags>>;

		if (state.repos.length > 1) {
			step = this.createConfirmStep(appendReposToTitle(`确认${context.title}`, state, context), [
				FlagsQuickPickItem.create<Flags>(state.flags, [], {
					label: this.title,
					detail: `将推送 ${state.repos.length} 仓库`,
				}),
				FlagsQuickPickItem.create<Flags>(state.flags, ['--force'], {
					label: `强制${this.title}${useForceWithLease ? '（使用 --force-with-lease）' : ''}`,
					description: `--force${useForceWithLease ? '-with-lease' : ''}`,
					detail: `将强制推送${useForceWithLease ? '（使用 --force-with-lease）' : ''} ${state.repos.length} 个仓库`,
				}),
			]);
		} else {
			const [repo] = state.repos;

			const items: FlagsQuickPickItem<Flags>[] = [];

			if (GitReference.isBranch(state.reference)) {
				if (state.reference.remote) {
					step = this.createConfirmStep(
						appendReposToTitle(`确认${context.title}`, state, context),
						[],
						DirectiveQuickPickItem.create(Directive.Cancel, true, {
							label: `取消${this.title}`,
							detail: '无法推送远程分支',
						}),
					);
				} else {
					const branch = await repo.getBranch(state.reference.name);
					const remote = await branch?.getRemote();

					if (branch?.upstream != null && remote == null) {
						step = this.createConfirmStep(
							appendReposToTitle(`确认${context.title}`, state, context),
							[],
							DirectiveQuickPickItem.create(Directive.Cancel, true, {
								label: `取消${this.title}`,
								detail: '无法推送；上游未关联有效的远程仓库',
							}),
						);
					} else if (branch != null && branch?.upstream == null) {
						for (const remote of await repo.getRemotes()) {
							items.push(
								FlagsQuickPickItem.create<Flags>(
									state.flags,
									['--set-upstream', remote.name, branch.name],
									{
										label: `将 ${branch.name} 发布到 ${remote.name}`,
										detail: `将发布 ${GitReference.toString(branch)} 至 ${remote.name}`,
									},
								),
							);
						}

						if (items.length) {
							step = this.createConfirmStep(
								appendReposToTitle('确认发布', state, context),
								items,
								undefined,
								{ placeholder: '确认发布' },
							);
						} else {
							step = this.createConfirmStep(
								appendReposToTitle('确认发布', state, context),
								[],
								DirectiveQuickPickItem.create(Directive.Cancel, true, {
									label: '取消发布',
									detail: '无法发布；未找到远程仓库',
								}),
								{ placeholder: '确认发布' },
							);
						}
					} else if (branch != null && branch?.state.behind > 0) {
						const currentBranch = await repo.getBranch();

						step = this.createConfirmStep(
							appendReposToTitle(`确认${context.title}`, state, context),
							branch.id === currentBranch?.id
								? [
										FlagsQuickPickItem.create<Flags>(state.flags, ['--force'], {
											label: `强制${this.title}${
												useForceWithLease ? '（使用 --force-with-lease）' : ''
											}`,
											description: `--force${useForceWithLease ? '-with-lease' : ''}`,
											detail: `将强制推送${
												useForceWithLease ? '（使用 --force-with-lease）' : ''
											} ${branch?.state.ahead ? ` ${branch.state.ahead} 个提交` : ''}${
												remote?.name ? ` 到 ${remote?.name}` : ''
											}${
												branch != null && branch.state.behind > 0
													? `，将覆盖 ${branch.state.behind} 个提交${
															remote?.name ? `（位于 ${remote?.name}）` : ''
													  }`
													: ''
											}`,
										}),
								  ]
								: [],
							DirectiveQuickPickItem.create(Directive.Cancel, true, {
								label: `取消${this.title}`,
								detail: `无法推送；${GitReference.toString(branch)} 比 ${remote?.name} 落后 ${
									branch.state.behind
								} 个提交`,
							}),
						);
					} else if (branch != null && branch?.state.ahead > 0) {
						step = this.createConfirmStep(appendReposToTitle(`确认${context.title}`, state, context), [
							FlagsQuickPickItem.create<Flags>(state.flags, [remote!.name], {
								label: this.title,
								detail: `将 ${branch.state.ahead} 个提交从 ${GitReference.toString(branch)} 推送到 ${
									remote?.name
								}`,
							}),
						]);
					} else {
						step = this.createConfirmStep(
							appendReposToTitle(`确认${context.title}`, state, context),
							[],
							DirectiveQuickPickItem.create(Directive.Cancel, true, {
								label: `取消${this.title}`,
								detail: '没有找到要推送的提交',
							}),
						);
					}
				}
			} else {
				const status = await repo.getStatus();
				const remote = await status?.getRemote();

				const branch: GitBranchReference = {
					refType: 'branch',
					name: status?.branch ?? 'HEAD',
					ref: status?.branch ?? 'HEAD',
					remote: false,
					repoPath: repo.path,
				};

				if (status?.upstream != null && remote == null) {
					step = this.createConfirmStep(
						appendReposToTitle(`确认${context.title}`, state, context),
						[],
						DirectiveQuickPickItem.create(Directive.Cancel, true, {
							label: `取消${this.title}`,
							detail: '无法推送；上游未关联有效的远程仓库',
						}),
					);
				} else if (status?.state.ahead === 0) {
					if (state.reference == null && status.upstream == null) {
						state.reference = branch;

						for (const remote of await repo.getRemotes()) {
							items.push(
								FlagsQuickPickItem.create<Flags>(
									state.flags,
									['--set-upstream', remote.name, status.branch],
									{
										label: `将 ${branch.name} 发布到 ${remote.name}`,
										detail: `将发布 ${GitReference.toString(branch)} 至 ${remote.name}`,
									},
								),
							);
						}
					}

					if (items.length) {
						step = this.createConfirmStep(
							appendReposToTitle('确认发布', state, context),
							items,
							undefined,
							{ placeholder: '确认发布' },
						);
					} else if (status.upstream == null) {
						step = this.createConfirmStep(
							appendReposToTitle('确认发布', state, context),
							[],
							DirectiveQuickPickItem.create(Directive.Cancel, true, {
								label: '取消发布',
								detail: '无法发布；未找到远程仓库',
							}),
							{ placeholder: '确认发布' },
						);
					} else {
						step = this.createConfirmStep(
							appendReposToTitle('确认推送', state, context),
							[],
							DirectiveQuickPickItem.create(Directive.Cancel, true, {
								label: `取消${this.title}`,
								detail: `无法推送；没有领先于 ${remote?.name} 的提交`,
							}),
						);
					}
				} else {
					let lastFetchedOn = '';

					const lastFetched = await repo.getLastFetched();
					if (lastFetched !== 0) {
						lastFetchedOn = `${Strings.pad(GlyphChars.Dot, 2, 2)}上次抓取于 ${Dates.getFormatter(
							new Date(lastFetched),
						).fromNow()}`;
					}

					let pushDetails;
					if (state.reference != null) {
						pushDetails = `${
							status?.state.ahead
								? ` 截至 ${GitReference.toString(state.reference, {
										label: false,
								  })}（含）的提交`
								: ''
						}${status?.upstream ? ` 到 ${remote?.name}` : ''}`;
					} else {
						pushDetails = `${status?.state.ahead ? ` ${status.state.ahead} 个提交` : ''}${
							status?.upstream ? ` 到 ${remote?.name}` : ''
						}`;
					}

					step = this.createConfirmStep(
						appendReposToTitle(`确认${context.title}`, state, context, lastFetchedOn),
						[
							...(status?.state.behind
								? []
								: [
										FlagsQuickPickItem.create<Flags>(state.flags, [], {
											label: this.title,
											detail: `将推送${pushDetails}`,
										}),
								  ]),
							FlagsQuickPickItem.create<Flags>(state.flags, ['--force'], {
								label: `强制${this.title}${useForceWithLease ? '（使用 --force-with-lease）' : ''}`,
								description: `--force${useForceWithLease ? '-with-lease' : ''}`,
								detail: `将强制推送${
									useForceWithLease ? '（使用 --force-with-lease）' : ''
								} ${pushDetails}${
									status != null && status.state.behind > 0
										? `，将覆盖 ${status.state.behind} 个提交${
												status?.upstream ? `（位于 ${remote?.name}）` : ''
										  }`
										: ''
								}`,
							}),
						],
						status?.state.behind
							? DirectiveQuickPickItem.create(Directive.Cancel, true, {
									label: `取消${this.title}`,
									detail: `无法推送；${GitReference.toString(branch)} 比${
										status?.upstream ? ` ${remote?.name}` : ''
									}落后 ${status.state.behind} 个提交`,
							  })
							: undefined,
					);

					step.additionalButtons = [QuickCommandButtons.Fetch];
					step.onDidClickButton = async (quickpick, button) => {
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
					};
				}
			}
		}

		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}
