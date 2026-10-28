# GitLess 简体中文版

GitLess 简体中文版基于 [maattdd/vscode-gitlens](https://github.com/maattdd/vscode-gitlens) 改进，原项目源自 [GitLens](https://github.com/gitkraken/vscode-gitlens)。扩展标识为 `happyplum.gitless-zh`。

## 本版改动

- 为侧边栏、菜单、命令和操作提示提供简体中文文案。
- 提交后自动刷新分支状态。
- 在 Windows（PowerShell 7）和 macOS/Linux（`/bin/bash`）中，自动 Git 命令各自打开可继续输入的新终端，避免占用已有终端及其未提交输入。
- 在“工作树管理”视图按仓库查看工作树，单击展开该工作树 HEAD 的提交；右键“打开工作树”可选当前窗口、新窗口或添加到工作区，打开前会尝试通过 VS Code 内置 Git 关联仓库。
- 工作树行显示相对其上游的领先／落后提交数和未提交文件数（含未跟踪文件，同一文件只计一次）；展开后复用分支视图的待推送箭头及分支／标签位置标记，悬浮可查看上游和完整状态。未设置上游或上游丢失时不会显示为已同步。
- 在“仓库”视图创建、删除、锁定和解锁 Git 工作树；切换到已在其他工作树签出的分支时，可选择在当前或新窗口打开对应工作树。

工作树列表和管理需要 Git 2.36 或更新版本。删除操作由 Git 检查未提交更改与锁定状态；失效的工作树记录需使用 Git 自身的 `worktree prune` 清理。

工作树状态从各自目录读取。未在当前窗口打开的工作树发生外部修改后，使用“工作树管理”的刷新按钮重新读取文件数、跟踪状态和提交标记；该视图不额外监视所有关联目录。

自动 Git 终端使用上述固定 shell，不加载用户的 profile 或 `.bashrc`。Windows 未安装 PowerShell 7 时保留原来的命令终端方式；macOS/Linux 需要 `/bin/bash` 可用。

提交历史、行级作者信息、分支和暂存区等原有功能可参阅[上游 GitLens 文档](https://github.com/gitkraken/vscode-gitlens)。

## 安装与构建

取得 VSIX 文件后，可在 VS Code 中运行“扩展：从 VSIX 安装”并选择该文件。也可以从源码构建：

```powershell
git clone https://github.com/happyplum/vscode-gitless-zh.git
cd vscode-gitless-zh
corepack yarn install --frozen-lockfile
corepack yarn bundle
corepack yarn vsce package --yarn
```

构建生成的 `.vsix` 文件可按上述方式安装。

## 兼容与来源

本版沿用原项目的 `gitlens.*` 命令、配置和视图标识。与 GitLens 或其他 GitLess 版本同时启用可能产生冲突，建议只启用其中一个。

本项目保留原有 MIT 许可证和版权声明，详见[许可证](https://github.com/happyplum/vscode-gitless-zh/blob/main/LICENSE)。问题反馈请提交到[本仓库 Issues](https://github.com/happyplum/vscode-gitless-zh/issues)。
