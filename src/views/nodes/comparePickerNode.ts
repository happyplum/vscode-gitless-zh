'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars, NamedRef } from '../../constants';
import { Container } from '../../container';
import { SearchAndCompareView, SearchAndCompareViewNode } from '../searchAndCompareView';
import { ContextValues, unknownGitUri, ViewNode } from './viewNode';

interface RepoRef {
	label: string;
	repoPath: string;
	ref: string | NamedRef;
}

export class ComparePickerNode extends ViewNode<SearchAndCompareView> {
	readonly order: number = Date.now();
	readonly pinned: boolean = false;

	constructor(view: SearchAndCompareView, parent: SearchAndCompareViewNode, public readonly selectedRef: RepoRef) {
		super(unknownGitUri, view, parent);
	}

	get canDismiss(): boolean {
		return true;
	}

	getChildren(): ViewNode[] {
		return [];
	}

	async getTreeItem(): Promise<TreeItem> {
		const selectedRef = this.selectedRef;
		const repoPath = selectedRef?.repoPath;

		let description;
		if (repoPath !== undefined) {
			if ((await Container.git.getRepositoryCount()) > 1) {
				const repo = await Container.git.getRepository(repoPath);
				description = repo?.formattedName ?? repoPath;
			}
		}

		let item;
		if (selectedRef == null) {
			item = new TreeItem(
				'比较 <分支、标签或引用> 与 <分支、标签或引用>',
				TreeItemCollapsibleState.None,
			);
			item.contextValue = ContextValues.ComparePicker;
			item.description = description;
			item.tooltip = `单击以选择或输入比较${GlyphChars.Ellipsis} 的引用`;
			item.command = {
				title: `比较${GlyphChars.Ellipsis}`,
				command: this.view.getQualifiedCommand('selectForCompare'),
			};
		} else {
			item = new TreeItem(
				`比较 ${selectedRef.label} 与 <分支、标签或引用>`,
				TreeItemCollapsibleState.None,
			);
			item.contextValue = ContextValues.ComparePickerWithRef;
			item.description = description;
			item.tooltip = `点击比较${selectedRef.label}与${GlyphChars.Ellipsis}`;
			item.command = {
				title: `比较${selectedRef.label}与${GlyphChars.Ellipsis}`,
				command: this.view.getQualifiedCommand('compareWithSelected'),
			};
		}

		return item;
	}
}
