const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const importPlugin = require('eslint-plugin-import');
const globals = require('globals');
const prettier = require('eslint-config-prettier/flat');

// Preserve the existing lint policy while migrating to ESLint 9 flat config.
const rules = {
	'consistent-return': ['error'],
	curly: ['error', 'multi-line', 'consistent'],
	'eol-last': ['error'],
	'linebreak-style': ['error', 'unix'],
	'new-parens': ['error'],
	'no-constant-condition': [
		'warn',
		{
			checkLoops: false,
		},
	],
	'no-caller': ['error'],
	'no-debugger': ['warn'],
	'no-else-return': ['warn'],
	'no-empty': [
		'warn',
		{
			allowEmptyCatch: true,
		},
	],
	'no-eval': ['error'],
	'no-ex-assign': ['warn'],
	'no-extend-native': ['error'],
	'no-extra-bind': ['error'],
	'no-floating-decimal': ['error'],
	'no-implicit-coercion': ['error'],
	'no-implied-eval': ['error'],
	'no-lone-blocks': ['error'],
	'no-lonely-if': ['error'],
	'no-loop-func': ['error'],
	'no-multi-spaces': ['error'],
	'no-return-assign': ['error'],
	'no-return-await': ['warn'],
	'no-self-compare': ['error'],
	'no-sequences': ['error'],
	'no-template-curly-in-string': ['warn'],
	'no-throw-literal': ['error'],
	'no-unmodified-loop-condition': ['warn'],
	'no-unneeded-ternary': ['error'],
	'no-useless-call': ['error'],
	'no-useless-catch': ['error'],
	'no-useless-computed-key': [
		'error',
		{
			enforceForClassMembers: false,
		},
	],
	'no-useless-concat': ['error'],
	'no-useless-rename': ['error'],
	'no-useless-return': ['error'],
	'no-var': ['error'],
	'no-with': ['error'],
	'object-shorthand': ['error', 'never'],
	'one-var': ['error', 'never'],
	'prefer-arrow-callback': ['error'],
	'prefer-const': [
		'error',
		{
			destructuring: 'all',
			ignoreReadBeforeAssign: false,
		},
	],
	'prefer-numeric-literals': ['error'],
	'prefer-object-spread': ['error'],
	'prefer-rest-params': ['error'],
	'prefer-spread': ['error'],
	'prefer-template': ['error'],
	quotes: [
		'error',
		'single',
		{
			avoidEscape: true,
			allowTemplateLiterals: true,
		},
	],
	semi: ['error', 'always'],
	'semi-style': ['error', 'last'],
	'sort-imports': [
		'error',
		{
			ignoreCase: true,
			ignoreDeclarationSort: true,
			ignoreMemberSort: false,
			memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
			allowSeparatedGroups: false,
		},
	],
	yoda: ['error'],
	'import/extensions': ['error', 'never'],
	'import/newline-after-import': ['warn'],
	'import/no-dynamic-require': ['error'],
	'import/no-default-export': ['error'],
	'import/no-self-import': ['error'],
	'import/no-unresolved': [
		'warn',
		{
			ignore: ['vscode'],
			caseSensitive: true,
			caseSensitiveStrict: false,
		},
	],
	'import/order': [
		'warn',
		{
			alphabetize: {
				order: 'asc',
				caseInsensitive: true,
			},
			groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
			'newlines-between': 'never',
			warnOnUnassignedImports: false,
		},
	],
	'@typescript-eslint/consistent-type-assertions': [
		'error',
		{
			assertionStyle: 'as',
			objectLiteralTypeAssertions: 'allow-as-parameter',
		},
	],
	'@typescript-eslint/naming-convention': [
		'error',
		{
			selector: 'variable',
			format: ['camelCase', 'PascalCase'],
			leadingUnderscore: 'allow',
			filter: {
				regex: '^_$',
				match: false,
			},
		},
		{
			selector: 'variableLike',
			format: ['camelCase'],
			leadingUnderscore: 'allow',
			filter: {
				regex: '^_$',
				match: false,
			},
		},
		{
			selector: 'memberLike',
			modifiers: ['private'],
			format: ['camelCase'],
			leadingUnderscore: 'allow',
		},
		{
			selector: 'memberLike',
			modifiers: ['private', 'readonly'],
			format: ['camelCase', 'PascalCase'],
			leadingUnderscore: 'allow',
		},
		{
			selector: 'memberLike',
			modifiers: ['static', 'readonly'],
			format: ['camelCase', 'PascalCase'],
		},
		{
			selector: 'interface',
			format: ['PascalCase'],
			custom: {
				regex: '^I[A-Z]',
				match: false,
			},
		},
	],
	'@typescript-eslint/no-floating-promises': ['error'],
	'@typescript-eslint/no-inferrable-types': [
		'warn',
		{
			ignoreParameters: true,
			ignoreProperties: true,
		},
	],
	'@typescript-eslint/no-misused-promises': [
		'error',
		{
			checksVoidReturn: false,
		},
	],
	'@typescript-eslint/no-unused-expressions': [
		'warn',
		{
			allowShortCircuit: true,
			allowTernary: false,
			allowTaggedTemplates: false,
			enforceForJSX: false,
		},
	],
	'@typescript-eslint/no-unused-vars': [
		'warn',
		{
			args: 'after-used',
			argsIgnorePattern: '^_',
			ignoreRestSiblings: true,
			varsIgnorePattern: '^_$',
		},
	],
	'@typescript-eslint/prefer-optional-chain': ['warn'],
	'@typescript-eslint/restrict-template-expressions': [
		'error',
		{
			allowAny: true,
			allowBoolean: true,
			allowNumber: true,
			allowNullish: true,
		},
	],
	'@typescript-eslint/strict-boolean-expressions': [
		'warn',
		{
			allowString: true,
			allowNumber: true,
			allowNullableObject: false,
			allowNullableBoolean: true,
			allowNullableNumber: true,
			allowNullableString: true,
			allowAny: false,
		},
	],
	'import/no-named-as-default': [1],
	'import/no-named-as-default-member': [1],
	'import/no-duplicates': [1],
	'import/default': [2],
	'@typescript-eslint/await-thenable': ['error'],
	'@typescript-eslint/no-for-in-array': ['error'],
	'@typescript-eslint/no-implied-eval': ['error'],
	'@typescript-eslint/no-unnecessary-type-assertion': ['error'],
	'@typescript-eslint/require-await': ['error'],
	'@typescript-eslint/restrict-plus-operands': ['error'],
	'@typescript-eslint/adjacent-overload-signatures': ['error'],
	'@typescript-eslint/ban-ts-comment': ['error'],
	'@typescript-eslint/no-array-constructor': ['error'],
	'@typescript-eslint/no-extra-non-null-assertion': ['error'],
	'@typescript-eslint/no-misused-new': ['error'],
	'@typescript-eslint/no-non-null-asserted-optional-chain': ['error'],
	'@typescript-eslint/no-this-alias': ['error'],
	'@typescript-eslint/no-unnecessary-type-constraint': ['error'],
	'@typescript-eslint/no-var-requires': ['error'],
	'@typescript-eslint/prefer-as-const': ['error'],
	'@typescript-eslint/prefer-namespace-keyword': ['error'],
	'@typescript-eslint/triple-slash-reference': ['error'],
	'for-direction': ['error'],
	'no-async-promise-executor': ['error'],
	'no-case-declarations': ['error'],
	'no-class-assign': ['error'],
	'no-compare-neg-zero': ['error'],
	'no-cond-assign': ['error'],
	'no-control-regex': ['error'],
	'no-delete-var': ['error'],
	'no-dupe-else-if': ['error'],
	'no-duplicate-case': ['error'],
	'no-empty-character-class': ['error'],
	'no-empty-pattern': ['error'],
	'no-extra-boolean-cast': ['error'],
	'no-fallthrough': ['error'],
	'no-global-assign': ['error'],
	'no-invalid-regexp': ['error'],
	'no-irregular-whitespace': ['error'],
	'no-misleading-character-class': ['error'],
	'no-nonoctal-decimal-escape': ['error'],
	'no-octal': ['error'],
	'no-prototype-builtins': ['error'],
	'no-regex-spaces': ['error'],
	'no-self-assign': ['error'],
	'no-shadow-restricted-names': ['error'],
	'no-sparse-arrays': ['error'],
	'no-unsafe-finally': ['error'],
	'no-unsafe-optional-chaining': ['error'],
	'no-unused-labels': ['error'],
	'no-useless-backreference': ['error'],
	'no-useless-escape': ['error'],
	'require-yield': ['error'],
	'use-isnan': ['error'],
	'@typescript-eslint/no-restricted-types': [
		'error',
		{
			types: {
				String: {
					message: 'Use string instead',
					fixWith: 'string',
				},
				Boolean: {
					message: 'Use boolean instead',
					fixWith: 'boolean',
				},
				Number: {
					message: 'Use number instead',
					fixWith: 'number',
				},
				Symbol: {
					message: 'Use symbol instead',
					fixWith: 'symbol',
				},
				Object: {
					message:
						'The `Object` type actually means "any non-nullish value", so it is marginally better than `unknown`.\n- If you want a type meaning "any object", you probably want `Record<string, unknown>` instead.\n- If you want a type meaning "any value", you probably want `unknown` instead.',
				},
				'{}': {
					message:
						'`{}` actually means "any non-nullish value".\n- If you want a type meaning "any object", you probably want `object` or `Record<string, unknown>` instead.\n- If you want a type meaning "any value", you probably want `unknown` instead.',
					fixWith: 'object',
				},
			},
		},
	],
	'@typescript-eslint/no-empty-object-type': [
		'error',
		{
			allowInterfaces: 'never',
			allowObjectTypes: 'always',
		},
	],
	'no-duplicate-imports': ['error'],
	'no-loss-of-precision': ['error'],
};

module.exports = [
	{ ignores: ['dist/**', 'src/@types/**', 'emojis.json', '**/*.tsbuildinfo'] },
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parser: tsParser,
			ecmaVersion: 2019,
			sourceType: 'module',
			globals: { ...globals.es2015, ...globals.node },
			parserOptions: {
				project: './tsconfig.json',
				tsconfigRootDir: __dirname,
				// Temporary workaround for TypeScript 6 typed-lint single-run inference issues.
				// https://github.com/microsoft/TypeScript/issues/64412
				// https://github.com/typescript-eslint/typescript-eslint/issues/12749
				disallowAutomaticSingleRunInference: true,
			},
		},
		plugins: { '@typescript-eslint': tsPlugin, import: importPlugin },
		linterOptions: { reportUnusedDisableDirectives: 'error' },
		settings: {
			'import/extensions': ['.ts', '.tsx', '.js', '.jsx'],
			'import/external-module-folders': ['node_modules', 'node_modules/@types'],
			'import/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
			'import/resolver': { node: { extensions: ['.ts', '.tsx', '.js', '.jsx'] } },
		},
		rules: { ...prettier.rules, ...rules },
	},
	{
		files: ['src/webviews/apps/**/*.ts'],
		languageOptions: { parserOptions: { project: './src/webviews/apps/tsconfig.json' } },
	},
];
