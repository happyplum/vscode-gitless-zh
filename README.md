# GitLess 简体中文版

GitLess 简体中文版基于 [maattdd/vscode-gitlens](https://github.com/maattdd/vscode-gitlens) 改进，原项目源自 [GitLens](https://github.com/gitkraken/vscode-gitlens)。扩展标识为 `happyplum.gitless-zh`。

## 本版改动

- 为侧边栏、菜单、命令和操作提示提供简体中文文案。
- 提交后自动刷新分支状态。
- Git 操作使用独立终端，避免占用正在运行开发服务的终端。

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
