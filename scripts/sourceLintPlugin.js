const path = require('path');
const { ESLint } = require('eslint');

// Lint the complete source scope, including files outside webpack's module graph.
class SourceLintPlugin {
	constructor(context, directory) {
		this.context = context;
		this.directory = directory;
	}

	apply(compiler) {
		const eslint = new ESLint({ cwd: this.context, fix: false, cache: false });
		compiler.hooks.afterCompile.tapPromise('SourceLintPlugin', async compilation => {
			// HTML template child compilers inherit this hook; the parent checks the whole source scope.
			if (compilation.compiler !== compiler) return;
			compilation.contextDependencies.add(path.resolve(this.context, this.directory));
			const results = await eslint.lintFiles(this.directory + '/**/*.ts');
			const formatter = await eslint.loadFormatter('stylish');
			for (const severity of [1, 2]) {
				const filtered = results
					.map(result => ({
						...result,
						messages: result.messages.filter(message => message.severity === severity),
						errorCount: severity === 2 ? result.errorCount : 0,
						warningCount: severity === 1 ? result.warningCount : 0,
						fixableErrorCount: severity === 2 ? result.fixableErrorCount : 0,
						fixableWarningCount: severity === 1 ? result.fixableWarningCount : 0,
					}))
					.filter(result => result.messages.length > 0);
				if (filtered.length === 0) continue;
				const issue = new compiler.webpack.WebpackError('[eslint]\n' + (await formatter.format(filtered)));
				if (severity === 2) compilation.errors.push(issue);
				else compilation.warnings.push(issue);
			}
		});
	}
}

module.exports = SourceLintPlugin;
