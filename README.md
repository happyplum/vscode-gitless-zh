# GitLess 简体中文版

GitLess 简体中文版基于 [maattdd/vscode-gitlens](https://github.com/maattdd/vscode-gitlens) 改进，原项目源自 [GitLens](https://github.com/gitkraken/vscode-gitlens)。扩展标识为 `happyplum.gitless-zh`。

## 本版改动

- 为侧边栏、菜单、命令和操作提示提供简体中文文案。
- 提交后自动刷新分支状态。
- 在 Windows（PowerShell 7）和 macOS/Linux（`/bin/bash`）中，自动 Git 命令各自打开可继续输入的新终端，避免占用已有终端及其未提交输入。
- 在“工作树管理”视图中，同一 Git 仓库的多个已打开工作树合并为一份列表；仅存在不同 Git 仓库时显示分组标题。当前窗口已打开的路径标为“当前工作树”，与“主工作树”分别显示，多根窗口可有多个当前工作树。单击展开该工作树 HEAD 的提交；右键“打开工作树”可选当前窗口、新窗口或添加到工作区，打开前会尝试通过 VS Code 内置 Git 关联仓库。
- 工作树行显示相对其上游的领先／落后提交数和未提交文件数（含未跟踪文件，同一文件只计一次）；展开后复用分支视图的待推送箭头及分支／标签位置标记，悬浮可查看上游和完整状态。未设置上游或上游丢失时不会显示为已同步。
- 在“仓库”视图创建、删除、锁定和解锁 Git 工作树；切换到已在其他工作树签出的分支时，可选择在当前或新窗口打开对应工作树。

工作树列表和管理需要 Git 2.36 或更新版本。删除操作由 Git 检查未提交更改与锁定状态；失效的工作树记录需使用 Git 自身的 `worktree prune` 清理。

工作树状态从各自目录读取。未在当前窗口打开的工作树发生外部修改后，使用“工作树管理”的刷新按钮重新读取文件数、跟踪状态和提交标记；该视图不额外监视所有关联目录。

自动 Git 终端使用上述固定 shell，不加载用户的 profile 或 `.bashrc`。Windows 未安装 PowerShell 7 时保留原来的命令终端方式；macOS/Linux 需要 `/bin/bash` 可用。

提交历史、行级作者信息、分支和暂存区等原有功能可参阅[上游 GitLens 文档](https://github.com/gitkraken/vscode-gitlens)。

## 更新日志

按新到旧最多保留 10 个版本／更新批次，“未发布”计为 1 批；不足 10 批时按实际记录保留。完整历史见 [CHANGELOG.md](CHANGELOG.md)。

### 未发布

- 交互式 Rebase 的动作选项显示为 `drop · 丢弃` 等“英文命令 · 中文释义”，恢复 `p/r/e/s/f/d` 首字母定位的操作习惯。

### 11.7.8（2026-10-28）

- 同一仓库的多个已打开工作树合并显示，统一分支名、“当前工作树”和“主工作树”的标记顺序。
- 保留各已打开工作树的刷新订阅，隐藏视图后恢复时重新读取变化。

### 11.7.7（2026-10-26）

- 工作树行显示相对上游的领先／落后提交数和未提交文件数，展开后显示待推送箭头及分支／标签位置。
- 悬浮提示区分未设置上游、上游丢失和分离 HEAD；手动刷新时清除 Git 缓存并重新读取状态。

### 11.7.6（2026-10-24）

- Windows（PowerShell 7）与 macOS/Linux（`/bin/bash`）中的自动 Git 命令使用独立交互式终端，执行结束后仍可继续输入。
- 保留已有终端及其未提交输入；Windows 未安装 PowerShell 7 时沿用原有终端方式。

### 11.7.5（2026-10-23）

- 新增独立“工作树管理”视图，支持展开提交，以及创建、删除、锁定、解锁和打开工作树。
- 切换到已被其他工作树占用的分支时，可选择打开对应工作树；分支删除改用可取消的独立终端。
- 保留 Merge、Rebase 等 Git 术语，修正菜单、设置、视图和强制操作提示中的错译。

### 11.7.4（2026-10-23）

- 补齐动态状态、快捷菜单和操作提示的中文文案，修复本地上游与远程分支识别。
- 修正自动 Git 命令的参数传递，统一处理 Webview 异步错误，避免 Insiders 打包污染工作区。
- 升级构建及运行依赖，最低支持 VS Code 1.101。

### 11.7.3（2026-10-21）

- 提供简体中文界面，覆盖侧边栏、命令、菜单、设置页和操作提示。
- 提交后自动刷新分支状态，Git 操作使用独立终端，避免占用已有终端。

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
