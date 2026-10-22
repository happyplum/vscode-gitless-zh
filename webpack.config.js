//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/* eslint-disable import/no-dynamic-require */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/prefer-optional-chain */
'use strict';
const path = require('path');
const CircularDependencyPlugin = require('circular-dependency-plugin');
const { CleanWebpackPlugin: CleanPlugin } = require('clean-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const CspHtmlPlugin = require('csp-html-webpack-plugin');
const esbuild = require('esbuild');
const { EsbuildPlugin } = require('esbuild-loader');
const ForkTsCheckerPlugin = require('fork-ts-checker-webpack-plugin');
const HtmlPlugin = require('html-webpack-plugin');
const ImageMinimizerPlugin = require('image-minimizer-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const SourceLintPlugin = require('./scripts/sourceLintPlugin');
const { ExtensionManifestPlugin } = require('./scripts/extensionManifest');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

const extensionRoot = path.join(__dirname, 'dist', 'extension');

class InlineChunkHtmlPlugin {
	constructor(htmlPlugin, patterns) {
		this.htmlPlugin = htmlPlugin;
		this.patterns = patterns;
	}

	getInlinedTag(publicPath, assets, tag) {
		if (
			(tag.tagName !== 'script' || !(tag.attributes && tag.attributes.src)) &&
			(tag.tagName !== 'link' || !(tag.attributes && tag.attributes.href))
		) {
			return tag;
		}

		let chunkName = tag.tagName === 'link' ? tag.attributes.href : tag.attributes.src;
		if (publicPath) {
			chunkName = chunkName.replace(publicPath, '');
		}
		if (!this.patterns.some(pattern => chunkName.match(pattern))) {
			return tag;
		}

		const asset = assets[chunkName];
		if (asset == null) {
			return tag;
		}

		return { tagName: tag.tagName === 'link' ? 'style' : tag.tagName, innerHTML: asset.source(), closeTag: true };
	}

	apply(compiler) {
		let publicPath = compiler.options.output.publicPath || '';
		if (publicPath && !publicPath.endsWith('/')) {
			publicPath += '/';
		}

		compiler.hooks.compilation.tap('InlineChunkHtmlPlugin', compilation => {
			const getInlinedTagFn = tag => this.getInlinedTag(publicPath, compilation.assets, tag);

			this.htmlPlugin.getHooks(compilation).alterAssetTagGroups.tap('InlineChunkHtmlPlugin', assets => {
				assets.headTags = assets.headTags.map(getInlinedTagFn);
				assets.bodyTags = assets.bodyTags.map(getInlinedTagFn);
			});
		});
	}
}

module.exports =
	/**
	 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; } | undefined } env
	 * @param {{ mode: 'production' | 'development' | 'none' | undefined; }} argv
	 * @returns { WebpackConfig[] }
	 */
	function (env, argv) {
		const mode = argv.mode || 'none';

		env = {
			analyzeBundle: false,
			analyzeDeps: false,
			...env,
		};

		return [getExtensionConfig(mode, env), getWebviewsConfig(mode)];
	};

/**
 * @param { 'production' | 'development' | 'none' } mode
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; }} env
 * @returns { WebpackConfig }
 */
function getExtensionConfig(mode, env) {
	/**
	 * @type WebpackConfig['plugins'] | any
	 */
	const plugins = [
		new ExtensionManifestPlugin(__dirname),
		new CleanPlugin({ cleanOnceBeforeBuildPatterns: ['**/*', '!webviews/**'] }),
		new ForkTsCheckerPlugin({
			async: false,
			formatter: 'basic',
		}),
		new SourceLintPlugin(__dirname, 'src'),
		new CopyPlugin({
			patterns: [{ from: 'scripts/gitTerminalRunner.js', to: 'gitTerminalRunner.js' }],
		}),
	];

	if (env.analyzeDeps) {
		plugins.push(
			new CircularDependencyPlugin({
				cwd: __dirname,
				exclude: /node_modules/,
				failOnError: false,
				onDetected: function ({ module: _webpackModuleRecord, paths, compilation }) {
					if (paths.some(p => p.includes('container.ts'))) return;

					compilation.warnings.push(new Error(paths.join(' -> ')));
				},
			}),
		);
	}

	if (env.analyzeBundle) {
		plugins.push(new BundleAnalyzerPlugin());
	}

	return {
		name: 'extension',
		entry: './src/extension.ts',
		mode: mode,
		target: 'node',
		node: {
			__dirname: false,
		},
		devtool: 'source-map',
		output: {
			path: path.join(extensionRoot, 'dist'),
			libraryTarget: 'commonjs2',
			filename: 'gitlens.js',
			chunkFilename: 'feature-[name].js',
		},
		optimization: {
			minimizer: [
				new EsbuildPlugin({
					format: 'cjs',
					// @ts-ignore
					implementation: esbuild,
					minify: true,
					treeShaking: true,
					// Keep the class names otherwise @log won't provide a useful name
					keepNames: true,
					target: 'es2019',
				}),
			],
			splitChunks: {
				cacheGroups: {
					defaultVendors: false,
				},
			},
		},
		externals: {
			vscode: 'commonjs vscode',
		},
		module: {
			rules: [
				{
					exclude: /\.d\.ts$/,
					include: path.join(__dirname, 'src'),
					test: /\.tsx?$/,
					use: {
						loader: 'esbuild-loader',
						options: {
							implementation: esbuild,
							loader: 'ts',
							target: 'es2019',
							tsconfigRaw: require('./tsconfig.json'),
						},
					},
				},
			],
		},
		resolve: {
			extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
			symlinks: false,
		},
		plugins: plugins,
		stats: {
			preset: 'errors-warnings',
			assets: true,
			colors: true,
			env: true,
			errorsCount: true,
			warningsCount: true,
			timings: true,
		},
	};
}

/**
 * @param { 'production' | 'development' | 'none' } mode
 * @returns { WebpackConfig }
 */
function getWebviewsConfig(mode) {
	const basePath = path.join(__dirname, 'src', 'webviews', 'apps');
	const htmlMinify =
		mode === 'production'
			? {
					removeComments: true,
					collapseWhitespace: true,
					removeRedundantAttributes: false,
					useShortDoctype: true,
					removeEmptyAttributes: true,
					removeStyleLinkTypeAttributes: true,
					keepClosingSlash: true,
					minifyCSS: true,
				}
			: false;

	const cspHtmlPlugin = new CspHtmlPlugin(
		{
			'default-src': "'none'",
			'img-src': ['#{cspSource}', 'https:', 'data:'],
			'script-src':
				mode !== 'production'
					? ['#{cspSource}', "'nonce-#{cspNonce}'", "'unsafe-eval'"]
					: ['#{cspSource}', "'nonce-#{cspNonce}'"],
			'style-src': ['#{cspSource}', "'nonce-#{cspNonce}'"],
			'font-src': ['#{cspSource}'],
		},
		{
			enabled: true,
			hashingMethod: 'sha256',
			hashEnabled: {
				'script-src': true,
				'style-src': true,
			},
			nonceEnabled: {
				'script-src': true,
				'style-src': true,
			},
		},
	);
	// Override the nonce creation so we can dynamically generate them at runtime
	cspHtmlPlugin.createNonce = () => '#{cspNonce}';

	/**
	 * @type WebpackConfig['plugins'] | any
	 */
	const plugins = [
		new ExtensionManifestPlugin(__dirname),
		new CleanPlugin({
			cleanOnceBeforeBuildPatterns: [
				'**/*',
				path.posix.join(extensionRoot.replace(/\\/g, '/'), 'images', 'settings', '**'),
			],
			dangerouslyAllowCleanPatternsOutsideProject: true,
			dry: false,
		}),
		new ForkTsCheckerPlugin({
			async: false,
			formatter: 'basic',
			typescript: {
				configFile: path.join(basePath, 'tsconfig.json'),
			},
		}),
		new SourceLintPlugin(__dirname, 'src/webviews/apps'),
		new MiniCssExtractPlugin({
			filename: '[name].css',
		}),
		new HtmlPlugin({
			template: 'rebase/rebase.html',
			chunks: ['rebase'],
			filename: path.join(extensionRoot, 'dist', 'webviews', 'rebase.html'),
			inject: true,
			inlineSource: mode === 'production' ? '.css$' : undefined,
			minify: htmlMinify,
		}),
		new HtmlPlugin({
			template: 'settings/settings.html',
			chunks: ['settings'],
			filename: path.join(extensionRoot, 'dist', 'webviews', 'settings.html'),
			inject: true,
			inlineSource: mode === 'production' ? '.css$' : undefined,
			minify: htmlMinify,
		}),
		new HtmlPlugin({
			template: 'welcome/welcome.html',
			chunks: ['welcome'],
			filename: path.join(extensionRoot, 'dist', 'webviews', 'welcome.html'),
			inject: true,
			inlineSource: mode === 'production' ? '.css$' : undefined,
			minify: htmlMinify,
		}),
		cspHtmlPlugin,
		new InlineChunkHtmlPlugin(HtmlPlugin, mode === 'production' ? ['\\.css$'] : []),
		new CopyPlugin({
			patterns: [
				{
					from: path.posix.join(basePath.replace(/\\/g, '/'), 'images', 'settings', '*.png'),
					to: path.posix.join(extensionRoot.replace(/\\/g, '/'), 'images', 'settings', '[name][ext]'),
				},
				{
					from: path.posix.join(
						__dirname.replace(/\\/g, '/'),
						'node_modules',
						'@vscode',
						'codicons',
						'dist',
						'codicon.ttf',
					),
					to: path.posix.join(extensionRoot.replace(/\\/g, '/'), 'dist', 'webviews'),
				},
			],
		}),
		new ImageMinimizerPlugin({
			test: /\.(png)$/i,
			loader: false,
			deleteOriginalAssets: true,
			generator: [
				{
					type: 'asset',
					filename: '[path][name].webp',
					implementation: ImageMinimizerPlugin.sharpGenerate,
					options: {
						encodeOptions: {
							webp: {
								lossless: true,
								nearLossless: false,
								quality: 100,
								effort: 4,
							},
						},
					},
				},
			],
		}),
	];

	return {
		name: 'webviews',
		context: basePath,
		entry: {
			rebase: './rebase/rebase.ts',
			settings: './settings/settings.ts',
			welcome: './welcome/welcome.ts',
		},
		mode: mode,
		target: 'web',
		devtool: 'source-map',
		output: {
			filename: '[name].js',
			path: path.join(extensionRoot, 'dist', 'webviews'),
			publicPath: '#{root}/dist/webviews/',
		},
		module: {
			rules: [
				{
					exclude: /\.d\.ts$/,
					include: path.join(__dirname, 'src'),
					test: /\.tsx?$/,
					use: {
						loader: 'esbuild-loader',
						options: {
							implementation: esbuild,
							loader: 'ts',
							target: 'es2019',
							tsconfigRaw: require(path.join(basePath, 'tsconfig.json')),
						},
					},
				},
				{
					test: /\.scss$/,
					use: [
						{
							loader: MiniCssExtractPlugin.loader,
						},
						{
							loader: 'css-loader',
							options: {
								sourceMap: true,
								url: false,
							},
						},
						{
							loader: 'sass-loader',
							options: {
								sourceMap: true,
							},
						},
					],
					exclude: /node_modules/,
				},
			],
		},
		resolve: {
			extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
			modules: [basePath, 'node_modules'],
			symlinks: false,
		},
		plugins: plugins,
		stats: {
			preset: 'errors-warnings',
			assets: true,
			colors: true,
			env: true,
			errorsCount: true,
			warningsCount: true,
			timings: true,
		},
		infrastructureLogging: {
			level: 'log', // enables logging required for problem matchers
		},
	};
}
