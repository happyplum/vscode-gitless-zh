'use strict';
import { QuickInputButtons, QuickPickItem, Uri, window } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitReference, GitStashCommit, GitStashReference, Repository, RunError } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { Logger } from '../../logger';
import { Messages } from '../../messages';
import { FlagsQuickPickItem, QuickPickItemOfT } from '../../quickpicks';
import { Strings } from '../../system';
import { GitActions, GitCommandsCommand } from '../gitCommands';
import {
	appendReposToTitle,
	AsyncStepResultGenerator,
	PartialStepState,
	pickRepositoryStep,
	pickStashStep,
	QuickCommand,
	QuickCommandButtons,
	QuickPickStep,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';

interface Context {
	repos: Repository[];
	title: string;
}

interface ApplyState {
	subcommand: 'apply';
	repo: string | Repository;
	reference: GitStashReference;
}

interface DropState {
	subcommand: 'drop';
	repo: string | Repository;
	reference: GitStashReference;
}

interface ListState {
	subcommand: 'list';
	repo: string | Repository;
	reference: /*GitStashReference |*/ GitStashCommit;
}

interface PopState {
	subcommand: 'pop';
	repo: string | Repository;
	reference: GitStashReference;
}

type PushFlags = '--include-untracked' | '--keep-index';

interface PushState {
	subcommand: 'push';
	repo: string | Repository;
	message?: string;
	uris?: Uri[];
	flags: PushFlags[];
}

type State = ApplyState | DropState | ListState | PopState | PushState;
type StashStepState<T extends State> = SomeNonNullable<StepState<T>, 'subcommand'>;
type ApplyStepState<T extends ApplyState = ApplyState> = StashStepState<ExcludeSome<T, 'repo', string>>;
type DropStepState<T extends DropState = DropState> = StashStepState<ExcludeSome<T, 'repo', string>>;
type ListStepState<T extends ListState = ListState> = StashStepState<ExcludeSome<T, 'repo', string>>;
type PopStepState<T extends PopState = PopState> = StashStepState<ExcludeSome<T, 'repo', string>>;
type PushStepState<T extends PushState = PushState> = StashStepState<ExcludeSome<T, 'repo', string>>;

const subcommandToTitleMap = new Map<State['subcommand'], string>([
	['apply', '应用'],
	['drop', '删除'],
	['list', '列出'],
	['pop', '弹出'],
	['push', '保存'],
]);
function getTitle(title: string, subcommand: State['subcommand'] | undefined) {
	return subcommand == null ? title : `${subcommandToTitleMap.get(subcommand)}${title}`;
}

export interface StashGitCommandArgs {
	readonly command: 'stash';
	confirm?: boolean;
	state?: Partial<State>;
}

export class StashGitCommand extends QuickCommand<State> {
	private subcommand: State['subcommand'] | undefined;

	constructor(args?: StashGitCommandArgs) {
		super('stash', 'stash', '储藏', {
			description: '储藏局部更改稍后重新应用',
		});

		let counter = 0;
		if (args?.state?.subcommand != null) {
			counter++;

			switch (args.state.subcommand) {
				case 'apply':
				case 'drop':
				case 'pop':
					if (args.state.reference != null) {
						counter++;
					}
					break;

				case 'push':
					if (args.state.message != null) {
						counter++;
					}

					break;
			}
		}

		if (args?.state?.repo != null) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: args?.confirm,
			...args?.state,
		};
	}

	override get canConfirm(): boolean {
		return this.subcommand != null && this.subcommand !== 'list';
	}

	override get canSkipConfirm(): boolean {
		return this.subcommand === 'drop' ? false : super.canSkipConfirm;
	}

	override get skipConfirmKey() {
		return `${this.key}${this.subcommand == null ? '' : `-${this.subcommand}`}:${this.pickedVia}`;
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: [...(await Container.git.getOrderedRepositories())],
			title: this.title,
		};

		let skippedStepTwo = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 || state.subcommand == null) {
				this.subcommand = undefined;

				const result = yield* this.pickSubcommandStep(state);
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.subcommand = result;
			}

			this.subcommand = state.subcommand;

			context.title = getTitle(this.title, state.subcommand);

			if (state.counter < 2 || state.repo == null || typeof state.repo === 'string') {
				skippedStepTwo = false;
				if (context.repos.length === 1) {
					skippedStepTwo = true;
					state.counter++;

					state.repo = context.repos[0];
				} else {
					const result = yield* pickRepositoryStep(state, context);
					if (result === StepResult.Break) continue;

					state.repo = result;
				}
			}

			switch (state.subcommand) {
				case 'apply':
				case 'pop':
					yield* this.applyOrPopCommandSteps(state as ApplyStepState | PopStepState, context);
					break;
				case 'drop':
					yield* this.dropCommandSteps(state as DropStepState, context);
					break;
				case 'list':
					yield* this.listCommandSteps(state as ListStepState, context);
					break;
				case 'push':
					yield* this.pushCommandSteps(state as PushStepState, context);
					break;
				default:
					QuickCommand.endSteps(state);
					break;
			}

			// If we skipped the previous step, make sure we back up past it
			if (skippedStepTwo) {
				state.counter--;
			}
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private *pickSubcommandStep(state: PartialStepState<State>): StepResultGenerator<State['subcommand']> {
		const step = QuickCommand.createPickStep<QuickPickItemOfT<State['subcommand']>>({
			title: this.title,
			placeholder: `选择${this.label}命令`,
			items: [
				{
					label: '应用',
					description: '将指定储藏中的更改集成到当前分支中',
					picked: state.subcommand === 'apply',
					item: 'apply',
				},
				{
					label: '删除',
					description: '删除指定的储藏',
					picked: state.subcommand === 'drop',
					item: 'drop',
				},
				{
					label: '列出',
					description: '列出已保存的储藏',
					picked: state.subcommand === 'list',
					item: 'list',
				},
				{
					label: '弹出',
					description:
						'将指定储藏中的更改集成到当前分支中并删除储藏',
					picked: state.subcommand === 'pop',
					item: 'pop',
				},
				{
					label: '保存',
					description:
						'将本地更改保存到新的储藏中，并从工作树和索引中移除这些更改',
					picked: state.subcommand === 'push',
					item: 'push',
				},
			],
			buttons: [QuickInputButtons.Back],
		});
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}

	private async *applyOrPopCommandSteps(state: ApplyStepState | PopStepState, context: Context): StepGenerator {
		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result: StepResult<GitStashReference> = yield* pickStashStep(state, context, {
					stash: await Container.git.getStash(state.repo.path),
					placeholder: (context, stash) =>
						stash == null
							? `${state.repo.formattedName} 中没有储藏`
							: '选择要应用到工作区的储藏',
					picked: state.reference?.ref,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.reference = result;
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.applyOrPopCommandConfirmStep(state, context);
				if (result === StepResult.Break) continue;

				state.subcommand = result;
			}

			QuickCommand.endSteps(state);
			try {
				void (await state.repo.stashApply(
					// pop can only take a stash index, e.g. `stash@{1}`
					state.subcommand === 'pop' ? `stash@{${state.reference.number}}` : state.reference.ref,
					{ deleteAfter: state.subcommand === 'pop' },
				));
			} catch (ex) {
				Logger.error(ex, context.title);

				if (ex instanceof Error) {
					const msg: string = ex.message ?? '';
					if (msg.includes('Your local changes to the following files would be overwritten by merge')) {
						void window.showWarningMessage(
							'无法应用储藏。您的工作树更改将被覆盖。请在重试之前提交或储藏您的更改',
						);

						return;
					}

					if (
						(msg.includes('Auto-merging') && msg.includes('CONFLICT')) ||
						(ex instanceof RunError &&
							((ex.stdout.includes('Auto-merging') && ex.stdout.includes('CONFLICT')) ||
								ex.stdout.includes('needs merge')))
					) {
						void window.showInformationMessage('应用储藏时发生冲突');

						return;
					}

					void Messages.showGenericErrorMessage(
						`无法应用储藏 — ${msg.trim().replace(/\n+?/g, '; ')}`,
					);

					return;
				}
			}
		}
	}

	private *applyOrPopCommandConfirmStep(
		state: ApplyStepState | PopStepState,
		context: Context,
	): StepResultGenerator<'apply' | 'pop'> {
		const step = this.createConfirmStep<QuickPickItem & { item: 'apply' | 'pop' }>(
			appendReposToTitle(`确认${context.title}`, state, context),
			[
				{
					label: context.title,
					detail:
						state.subcommand === 'pop'
							? `将删除 ${GitReference.toString(
									state.reference,
							  )} 并将更改应用到工作树`
							: `将 ${GitReference.toString(
									state.reference,
							  )} 的更改应用于工作树`,
					item: state.subcommand,
				},
				// Alternate confirmation (if pop then apply, and vice versa)
				{
					label: getTitle(this.title, state.subcommand === 'pop' ? 'apply' : 'pop'),
					detail:
						state.subcommand === 'pop'
							? `将 ${GitReference.toString(
									state.reference,
							  )} 的更改应用于工作树`
							: `将删除 ${GitReference.toString(
									state.reference,
							  )} 并将更改应用到工作树`,
					item: state.subcommand === 'pop' ? 'apply' : 'pop',
				},
			],
			undefined,
			{
				placeholder: `确认${context.title}`,
				additionalButtons: [QuickCommandButtons.RevealInSideBar],
				onDidClickButton: (quickpick, button) => {
					if (button === QuickCommandButtons.RevealInSideBar) {
						void GitActions.Stash.reveal(state.reference, {
							select: true,
							expand: true,
						});
					}
				},
			},
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}

	private async *dropCommandSteps(state: DropStepState, context: Context): StepGenerator {
		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result: StepResult<GitStashReference> = yield* pickStashStep(state, context, {
					stash: await Container.git.getStash(state.repo.path),
					placeholder: (context, stash) =>
						stash == null ? `${state.repo.formattedName} 中没有储藏` : '选择要删除的储藏',
					picked: state.reference?.ref,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.reference = result;
			}

			const result = yield* this.dropCommandConfirmStep(state, context);
			if (result === StepResult.Break) continue;

			QuickCommand.endSteps(state);
			try {
				// drop can only take a stash index, e.g. `stash@{1}`
				void (await state.repo.stashDelete(`stash@{${state.reference.number}}`, state.reference.ref));
			} catch (ex) {
				Logger.error(ex, context.title);

				void Messages.showGenericErrorMessage('无法删除储藏');

				return;
			}
		}
	}

	private *dropCommandConfirmStep(state: DropStepState, context: Context): StepResultGenerator<void> {
		const step = this.createConfirmStep(
			appendReposToTitle(`确认${context.title}`, state, context),
			[
				{
					label: context.title,
					detail: `将删除${GitReference.toString(state.reference)}`,
				},
			],
			undefined,
			{
				placeholder: `确认${context.title}`,
				additionalButtons: [QuickCommandButtons.RevealInSideBar],
				onDidClickButton: (quickpick, button) => {
					if (button === QuickCommandButtons.RevealInSideBar) {
						void GitActions.Stash.reveal(state.reference, {
							select: true,
							expand: true,
						});
					}
				},
			},
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? undefined : StepResult.Break;
	}

	private async *listCommandSteps(state: ListStepState, context: Context): StepGenerator {
		context.title = '储藏';

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.reference == null) {
				const result: StepResult<GitStashCommit> = yield* pickStashStep(state, context, {
					stash: await Container.git.getStash(state.repo.path),
					placeholder: (context, stash) =>
						stash == null ? `${state.repo.formattedName} 中没有储藏` : '选择储藏',
					picked: state.reference?.ref,
				});
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.reference = result;
			}

			// if (!(state.reference instanceof GitStashCommit)) {
			// 	state.reference = await Container.git.getCommit(state.repo.path, state.reference.ref);
			// }

			const result = yield* GitCommandsCommand.getSteps(
				{
					command: 'show',
					state: {
						repo: state.repo,
						reference: state.reference,
					},
				},
				this.pickedVia,
			);
			state.counter--;
			if (result === StepResult.Break) {
				QuickCommand.endSteps(state);
			}
		}
	}

	private async *pushCommandSteps(state: PushStepState, context: Context): StepGenerator {
		if (state.flags == null) {
			state.flags = [];
		}

		while (this.canStepsContinue(state)) {
			if (state.counter < 3 || state.message == null) {
				const result = yield* this.pushCommandInputMessageStep(state, context);
				// Always break on the first step (so we will go back)
				if (result === StepResult.Break) break;

				state.message = result;
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.pushCommandConfirmStep(state, context);
				if (result === StepResult.Break) continue;

				state.flags = result;
			}

			QuickCommand.endSteps(state);
			try {
				void (await state.repo.stashSave(state.message, state.uris, {
					includeUntracked: state.flags.includes('--include-untracked'),
					keepIndex: state.flags.includes('--keep-index'),
				}));
			} catch (ex) {
				Logger.error(ex, context.title);

				const msg: string = ex?.message ?? ex?.toString() ?? '';
				if (msg.includes('newer version of Git')) {
					void window.showErrorMessage(`无法储藏更改。 ${msg}`);

					return;
				}

				void Messages.showGenericErrorMessage('无法储藏更改');

				return;
			}
		}
	}

	private async *pushCommandInputMessageStep(
		state: PushStepState,
		context: Context,
	): AsyncStepResultGenerator<string> {
		const step = QuickCommand.createInputStep({
			title: appendReposToTitle(
				context.title,
				state,
				context,
				state.uris != null
					? `${Strings.pad(GlyphChars.Dot, 2, 2)}${
							state.uris.length === 1
								? GitUri.getFormattedFilename(state.uris[0])
								: `${state.uris.length} 个文件`
					  }`
					: undefined,
			),
			placeholder: '请提供储藏消息',
			value: state.message,
			prompt: '输入储藏消息',
		});

		const value: StepSelection<typeof step> = yield step;
		if (
			!QuickCommand.canStepContinue(step, state, value) ||
			!(await QuickCommand.canInputStepContinue(step, state, value))
		) {
			return StepResult.Break;
		}

		return value;
	}

	private *pushCommandConfirmStep(state: PushStepState, context: Context): StepResultGenerator<PushFlags[]> {
		const step: QuickPickStep<FlagsQuickPickItem<PushFlags>> = this.createConfirmStep(
			appendReposToTitle(`确认${context.title}`, state, context),
			state.uris == null || state.uris.length === 0
				? [
						FlagsQuickPickItem.create<PushFlags>(state.flags, [], {
							label: context.title,
							detail: '将储藏未提交的更改',
						}),
						FlagsQuickPickItem.create<PushFlags>(state.flags, ['--include-untracked'], {
							label: `${context.title} & 包括未追踪`,
							description: '--include-untracked',
							detail: '将储藏未提交的更改，包括未跟踪的文件',
						}),
						FlagsQuickPickItem.create<PushFlags>(state.flags, ['--keep-index'], {
							label: `${context.title}并保留暂存内容`,
							description: '--keep-index',
							detail: '将储藏未提交的更改，但将保持暂存文件完整',
						}),
				  ]
				: [
						FlagsQuickPickItem.create<PushFlags>(state.flags, [], {
							label: context.title,
							detail: `将储藏 ${state.uris.length === 1
									? GitUri.getFormattedFilename(state.uris[0])
									: `${state.uris.length} 个文件`} 的更改`,
						}),
						FlagsQuickPickItem.create<PushFlags>(state.flags, ['--keep-index'], {
							label: `${context.title}并保留暂存内容`,
							detail: `将储藏 ${state.uris.length === 1
									? GitUri.getFormattedFilename(state.uris[0])
									: `${state.uris.length} 个文件`} 的更改，但将保持暂存文件完整`,
						}),
				  ],
			undefined,
			{ placeholder: `确认${context.title}` },
		);
		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}
