# Lookup module

This module provides the way to find files and configs.

- [`ConfigArray`](./config-array.js) ... finds config files and resolve those dependencies recursively. All `extends` properties and `overrides` properties are flattened to one array. This doesn't register the loaded plugins/parsers to anywhere. Instead, the config instance itself has the entity of the loaded plugins/parsers. (Because I thought such a registration caused complexity. No registration means no side-effects which affects to out of this module in the loading process. Just use returned values.)

- [`FileEnumerator`](./file-enumerator.js) ... enumerates files which are matched by given glob patterns as loading config files. When it entered into a directory, (1) reads the config file on the directory, then (2) enumerates files on the directory. Therefore, it can use the config data in order to choose enumerated files.

- [`IgnoredPaths`](./ignored-paths.js) ... is as is. `FileEnumerator` uses it to ignore large directories such as `node_modules`.

To increase maintainability, I moved some files that only this module is using into this module from `util` directory. In my 2 cents, `util` directory is similar to global variables. It makes harder to know who is using a utility. The utility that only one functionality is using should be located at the directory of the functionality.

## Usage

Basic usage is:

```js
"use strict"

const { FileEnumerator, IgnoredPaths } = require("./lookup")

// Instantiate with options.
// The options will come from the options of CLIEngine.
const enumerator = new FileEnumerator({
    baseConfig: null,
    cliConfig: null,
    cwd: process.cwd(),
    extensions: [".js"],
    ignore: true,
    ignoredPaths: new IgnoredPaths(),
    specificConfigPath: null,
    useEslintrc: true
})
const patterns = ["lib/**/*.js", "tests", "test.js"]


// Enumerate files and the paired config.
// In most cases, the `config` instance is one same object. If a config file
// existed in a subdirectory, it will another object only in the subdirectory.
for (const { filePath, config } of enumerator.iterateFiles(patterns)) {
    console.log(filePath) // The absolute path to found file.
    console.log(config)   // The `ConfigArray` instance for the file.
}
```

## Details about config normalization

- All `extends` are loaded immediately. If faild to load, throw errors.

- All `extends` and `overrides` are flattened. <details><summary>For example:</summary>

    ```jsonc
    {
        "extends": ["eslint:recommended", "plugin:node/recommended"],
        "rules": { ... },
        "overrides": [
            {
                "files": ["*.ts"],
                "extends": ["plugin:@typescript-eslint/recommended"],
                "rules": { ... },
            }
        ]
    }
    ```

    is flattend to:

    ```jsonc
    [
        // extends
        {
            "name": "eslint:recommended",
            "filePath": null,
            "rules": { ... }
        },
        {
            "name": "plugin:node/recommended",
            "filePath": "node_modules/eslint-plugin-node/lib/index.js",
            "env": { ... },
            "parserOptions": { ... },
            "plugins": { ... },
            "rules": { ... }
        },

        // main
        {
            "name": ".eslintrc.json",
            "filePath": ".eslintrc.json",
            "rules": { ... }
        },

        // overrides (because it flattens recursively, extends in overrides is here)
        {
            "name": "plugin:@typescript-eslint/recommended",
            "filePath": "node_modules/@typescript-eslint/eslint-plugin/dist/index.js",
            // `matchFile` is merged from the parent `overrides` entry and itself.
            "matchFile": { "includes": ["*.ts"], "excludes": null },
            "parser": { ... },
            "parserOptions": { ... },
            "plugins": { ... },
            "rules": { ... },
        },
        {
            "name": ".eslintrc.json#overrides[0]",
            "filePath": ".eslintrc.json",
            "matchFile": { "includes": ["*.ts"], "excludes": null }
        }
    ]
    ```

    </details>

- All `parser` and `plugins` are resolved immediately. <details><summary>For example, above `plugin:@typescript-eslint/recommended` has `parser` and `plugins`:</summary>

    ```jsonc
    {
        "name": "plugin:@typescript-eslint/recommended",
        "filePath": "node_modules/@typescript-eslint/eslint-plugin/dist/index.js",
        "matchFile": { "includes": ["*.ts"], "excludes": null },
        // the config has parser implementation directly.
        "parser": {
            "definition": { ... }, // the parser implementation.
            "id": "@typescript-eslint/parser",
            "filePath": "node_modules/@typescript-eslint/parser/dist/index.js",
            "importerPath": "node_modules/@typescript-eslint/eslint-plugin/dist/index.js"
        },
        "parserOptions": {
            "sourceType": "module"
        },
        // `plugins` string array is replaced to an object.
        "plugins": {
            // the config has plugin implementation directly.
            "@typescript-eslint": {
                "definition": { ... }, // the plugin implementation.
                "id": "@typescript-eslint",
                "filePath": "node_modules/@typescript-eslint/eslint-plugin/dist/index.js",
                "importerPath": "node_modules/@typescript-eslint/eslint-plugin/dist/index.js"
            }
        },
    },
    ```

    </details>

- If `parser` and `plugins` threw errors while loading, the config object has the error information. If the errored plugins/parsers were actually used, the error will be thrown. <details><summary>For example:</summary>

    ```jsonc
    {
        "name": "plugin:@typescript-eslint/recommended",
        "filePath": "node_modules/@typescript-eslint/eslint-plugin/dist/index.js",
        "matchFile": { "includes": ["*.ts"], "excludes": null },
        // the config has parser implementation directly.
        "parser": {
            "error": Error, // an `Error` object.
            "id": "@typescript-eslint/parser",
            "importerPath": "node_modules/@typescript-eslint/eslint-plugin/dist/index.js"
        },
        "parserOptions": {
            "sourceType": "module"
        },
        // `plugins` string array is replaced to an object.
        "plugins": {
            // the config has plugin implementation directly.
            "@typescript-eslint": {
                "error": Error, // an `Error` object.
                "id": "@typescript-eslint",
                "importerPath": "node_modules/@typescript-eslint/eslint-plugin/dist/index.js"
            }
        },
    },
    ```

    </details>

- `ConfigArray#extractConfig(filePath)` method merges the config array to one object. Filesystem isn't used while extracting because all information has been loaded. If the extracted `parser` or `plugins` has `error`, the method throws the error.

<details><summary>.eslintrc.js in this repository became:</summary>

```json
[
    {
        "name": "eslint:recommended",
        "filePath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\conf\\eslint-recommended.js",
        "rules": {
            "accessor-pairs": "off",
            "array-bracket-newline": "off",
            "array-bracket-spacing": "off",
            "array-callback-return": "off",
            "array-element-newline": "off",
            "arrow-body-style": "off",
            "arrow-parens": "off",
            "arrow-spacing": "off",
            "block-scoped-var": "off",
            "block-spacing": "off",
            "brace-style": "off",
            "callback-return": "off",
            "camelcase": "off",
            "capitalized-comments": "off",
            "class-methods-use-this": "off",
            "comma-dangle": "off",
            "comma-spacing": "off",
            "comma-style": "off",
            "complexity": "off",
            "computed-property-spacing": "off",
            "consistent-return": "off",
            "consistent-this": "off",
            "constructor-super": "error",
            "curly": "off",
            "default-case": "off",
            "dot-location": "off",
            "dot-notation": "off",
            "eol-last": "off",
            "eqeqeq": "off",
            "for-direction": "error",
            "func-call-spacing": "off",
            "func-name-matching": "off",
            "func-names": "off",
            "func-style": "off",
            "function-paren-newline": "off",
            "generator-star-spacing": "off",
            "getter-return": "error",
            "global-require": "off",
            "guard-for-in": "off",
            "handle-callback-err": "off",
            "id-blacklist": "off",
            "id-length": "off",
            "id-match": "off",
            "implicit-arrow-linebreak": "off",
            "indent": "off",
            "indent-legacy": "off",
            "init-declarations": "off",
            "jsx-quotes": "off",
            "key-spacing": "off",
            "keyword-spacing": "off",
            "line-comment-position": "off",
            "linebreak-style": "off",
            "lines-around-comment": "off",
            "lines-around-directive": "off",
            "lines-between-class-members": "off",
            "max-classes-per-file": "off",
            "max-depth": "off",
            "max-len": "off",
            "max-lines": "off",
            "max-lines-per-function": "off",
            "max-nested-callbacks": "off",
            "max-params": "off",
            "max-statements": "off",
            "max-statements-per-line": "off",
            "multiline-comment-style": "off",
            "multiline-ternary": "off",
            "new-cap": "off",
            "new-parens": "off",
            "newline-after-var": "off",
            "newline-before-return": "off",
            "newline-per-chained-call": "off",
            "no-alert": "off",
            "no-array-constructor": "off",
            "no-async-promise-executor": "off",
            "no-await-in-loop": "off",
            "no-bitwise": "off",
            "no-buffer-constructor": "off",
            "no-caller": "off",
            "no-case-declarations": "error",
            "no-catch-shadow": "off",
            "no-class-assign": "error",
            "no-compare-neg-zero": "error",
            "no-cond-assign": "error",
            "no-confusing-arrow": "off",
            "no-console": "error",
            "no-const-assign": "error",
            "no-constant-condition": "error",
            "no-continue": "off",
            "no-control-regex": "error",
            "no-debugger": "error",
            "no-delete-var": "error",
            "no-div-regex": "off",
            "no-dupe-args": "error",
            "no-dupe-class-members": "error",
            "no-dupe-keys": "error",
            "no-duplicate-case": "error",
            "no-duplicate-imports": "off",
            "no-else-return": "off",
            "no-empty": "error",
            "no-empty-character-class": "error",
            "no-empty-function": "off",
            "no-empty-pattern": "error",
            "no-eq-null": "off",
            "no-eval": "off",
            "no-ex-assign": "error",
            "no-extend-native": "off",
            "no-extra-bind": "off",
            "no-extra-boolean-cast": "error",
            "no-extra-label": "off",
            "no-extra-parens": "off",
            "no-extra-semi": "error",
            "no-fallthrough": "error",
            "no-floating-decimal": "off",
            "no-func-assign": "error",
            "no-global-assign": "error",
            "no-implicit-coercion": "off",
            "no-implicit-globals": "off",
            "no-implied-eval": "off",
            "no-inline-comments": "off",
            "no-inner-declarations": "error",
            "no-invalid-regexp": "error",
            "no-invalid-this": "off",
            "no-irregular-whitespace": "error",
            "no-iterator": "off",
            "no-label-var": "off",
            "no-labels": "off",
            "no-lone-blocks": "off",
            "no-lonely-if": "off",
            "no-loop-func": "off",
            "no-magic-numbers": "off",
            "no-misleading-character-class": "off",
            "no-mixed-operators": "off",
            "no-mixed-requires": "off",
            "no-mixed-spaces-and-tabs": "error",
            "no-multi-assign": "off",
            "no-multi-spaces": "off",
            "no-multi-str": "off",
            "no-multiple-empty-lines": "off",
            "no-native-reassign": "off",
            "no-negated-condition": "off",
            "no-negated-in-lhs": "off",
            "no-nested-ternary": "off",
            "no-new": "off",
            "no-new-func": "off",
            "no-new-object": "off",
            "no-new-require": "off",
            "no-new-symbol": "error",
            "no-new-wrappers": "off",
            "no-obj-calls": "error",
            "no-octal": "error",
            "no-octal-escape": "off",
            "no-param-reassign": "off",
            "no-path-concat": "off",
            "no-plusplus": "off",
            "no-process-env": "off",
            "no-process-exit": "off",
            "no-proto": "off",
            "no-prototype-builtins": "off",
            "no-redeclare": "error",
            "no-regex-spaces": "error",
            "no-restricted-globals": "off",
            "no-restricted-imports": "off",
            "no-restricted-modules": "off",
            "no-restricted-properties": "off",
            "no-restricted-syntax": "off",
            "no-return-assign": "off",
            "no-return-await": "off",
            "no-script-url": "off",
            "no-self-assign": "error",
            "no-self-compare": "off",
            "no-sequences": "off",
            "no-shadow": "off",
            "no-shadow-restricted-names": "off",
            "no-spaced-func": "off",
            "no-sparse-arrays": "error",
            "no-sync": "off",
            "no-tabs": "off",
            "no-template-curly-in-string": "off",
            "no-ternary": "off",
            "no-this-before-super": "error",
            "no-throw-literal": "off",
            "no-trailing-spaces": "off",
            "no-undef": "error",
            "no-undef-init": "off",
            "no-undefined": "off",
            "no-underscore-dangle": "off",
            "no-unexpected-multiline": "error",
            "no-unmodified-loop-condition": "off",
            "no-unneeded-ternary": "off",
            "no-unreachable": "error",
            "no-unsafe-finally": "error",
            "no-unsafe-negation": "error",
            "no-unused-expressions": "off",
            "no-unused-labels": "error",
            "no-unused-vars": "error",
            "no-use-before-define": "off",
            "no-useless-call": "off",
            "no-useless-catch": "off",
            "no-useless-computed-key": "off",
            "no-useless-concat": "off",
            "no-useless-constructor": "off",
            "no-useless-escape": "error",
            "no-useless-rename": "off",
            "no-useless-return": "off",
            "no-var": "off",
            "no-void": "off",
            "no-warning-comments": "off",
            "no-whitespace-before-property": "off",
            "no-with": "off",
            "nonblock-statement-body-position": "off",
            "object-curly-newline": "off",
            "object-curly-spacing": "off",
            "object-property-newline": "off",
            "object-shorthand": "off",
            "one-var": "off",
            "one-var-declaration-per-line": "off",
            "operator-assignment": "off",
            "operator-linebreak": "off",
            "padded-blocks": "off",
            "padding-line-between-statements": "off",
            "prefer-arrow-callback": "off",
            "prefer-const": "off",
            "prefer-destructuring": "off",
            "prefer-numeric-literals": "off",
            "prefer-object-spread": "off",
            "prefer-promise-reject-errors": "off",
            "prefer-reflect": "off",
            "prefer-rest-params": "off",
            "prefer-spread": "off",
            "prefer-template": "off",
            "quote-props": "off",
            "quotes": "off",
            "radix": "off",
            "require-atomic-updates": "off",
            "require-await": "off",
            "require-jsdoc": "off",
            "require-unicode-regexp": "off",
            "require-yield": "error",
            "rest-spread-spacing": "off",
            "semi": "off",
            "semi-spacing": "off",
            "semi-style": "off",
            "sort-imports": "off",
            "sort-keys": "off",
            "sort-vars": "off",
            "space-before-blocks": "off",
            "space-before-function-paren": "off",
            "space-in-parens": "off",
            "space-infix-ops": "off",
            "space-unary-ops": "off",
            "spaced-comment": "off",
            "strict": "off",
            "switch-colon-spacing": "off",
            "symbol-description": "off",
            "template-curly-spacing": "off",
            "template-tag-spacing": "off",
            "unicode-bom": "off",
            "use-isnan": "error",
            "valid-jsdoc": "off",
            "valid-typeof": "error",
            "vars-on-top": "off",
            "wrap-iife": "off",
            "wrap-regex": "off",
            "yield-star-spacing": "off",
            "yoda": "off"
        }
    },
    {
        "name": "plugin:node/recommended",
        "filePath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\node_modules\\eslint-plugin-node\\lib\\index.js",
        "env": {
            "es6": true,
            "node": true
        },
        "globals": {
            "Atomics": false,
            "SharedArrayBuffer": false
        },
        "parserOptions": {
            "ecmaVersion": 2019
        },
        "plugins": {
            "node": {
                "definition": { ... },
                "filePath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\node_modules\\eslint-plugin-node\\lib\\index.js",
                "id": "node",
                "importerPath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\node_modules\\eslint-plugin-node\\lib\\index.js"
            }
        },
        "rules": {
            "no-process-exit": "error",
            "node/exports-style": "off",
            "node/no-deprecated-api": "error",
            "node/no-extraneous-import": "off",
            "node/no-extraneous-require": "error",
            "node/no-missing-import": "off",
            "node/no-missing-require": "error",
            "node/no-unpublished-bin": "error",
            "node/no-unpublished-import": "off",
            "node/no-unpublished-require": "error",
            "node/no-unsupported-features/es-builtins": "error",
            "node/no-unsupported-features/es-syntax": "error",
            "node/no-unsupported-features/node-builtins": "error",
            "node/prefer-global/buffer": "off",
            "node/prefer-global/console": "off",
            "node/prefer-global/process": "off",
            "node/prefer-global/text-decoder": "off",
            "node/prefer-global/text-encoder": "off",
            "node/prefer-global/url-search-params": "off",
            "node/prefer-global/url": "off",
            "node/process-exit-as-throw": "error",
            "node/shebang": "error"
        }
    },
    {
        "name": "default.yml",
        "filePath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\packages\\eslint-config-eslint\\default.yml",
        "rules": {
            "array-bracket-spacing": "error",
            "array-callback-return": "error",
            "arrow-body-style": [
                "error",
                "as-needed"
            ],
            "arrow-parens": [
                "error",
                "as-needed"
            ],
            "arrow-spacing": "error",
            "indent": [
                "error",
                4,
                {
                    "SwitchCase": 1
                }
            ],
            "block-spacing": "error",
            "brace-style": [
                "error",
                "1tbs"
            ],
            "camelcase": "error",
            "callback-return": [
                "error",
                [
                    "cb",
                    "callback",
                    "next"
                ]
            ],
            "class-methods-use-this": "error",
            "comma-dangle": "error",
            "comma-spacing": "error",
            "comma-style": [
                "error",
                "last"
            ],
            "computed-property-spacing": "error",
            "consistent-return": "error",
            "curly": [
                "error",
                "all"
            ],
            "default-case": "error",
            "dot-location": [
                "error",
                "property"
            ],
            "dot-notation": [
                "error",
                {
                    "allowKeywords": true
                }
            ],
            "eol-last": "error",
            "eqeqeq": "error",
            "func-call-spacing": "error",
            "func-style": [
                "error",
                "declaration"
            ],
            "function-paren-newline": [
                "error",
                "consistent"
            ],
            "generator-star-spacing": "error",
            "guard-for-in": "error",
            "handle-callback-err": [
                "error",
                "err"
            ],
            "key-spacing": [
                "error",
                {
                    "beforeColon": false,
                    "afterColon": true
                }
            ],
            "keyword-spacing": "error",
            "lines-around-comment": [
                "error",
                {
                    "beforeBlockComment": true,
                    "afterBlockComment": false,
                    "beforeLineComment": true,
                    "afterLineComment": false
                }
            ],
            "max-len": [
                "error",
                160,
                {
                    "ignoreComments": true,
                    "ignoreUrls": true,
                    "ignoreStrings": true,
                    "ignoreTemplateLiterals": true,
                    "ignoreRegExpLiterals": true
                }
            ],
            "max-statements-per-line": "error",
            "new-cap": "error",
            "new-parens": "error",
            "no-alert": "error",
            "no-array-constructor": "error",
            "no-async-promise-executor": "error",
            "no-buffer-constructor": "error",
            "no-caller": "error",
            "no-confusing-arrow": "error",
            "no-console": "error",
            "no-delete-var": "error",
            "no-else-return": [
                "error",
                {
                    "allowElseIf": false
                }
            ],
            "no-eval": "error",
            "no-extend-native": "error",
            "no-extra-bind": "error",
            "no-fallthrough": "error",
            "no-floating-decimal": "error",
            "no-global-assign": "error",
            "no-implied-eval": "error",
            "no-invalid-this": "error",
            "no-iterator": "error",
            "no-label-var": "error",
            "no-labels": "error",
            "no-lone-blocks": "error",
            "no-loop-func": "error",
            "no-mixed-requires": "error",
            "no-mixed-spaces-and-tabs": [
                "error",
                false
            ],
            "no-multi-spaces": "error",
            "no-multi-str": "error",
            "no-multiple-empty-lines": [
                "error",
                {
                    "max": 2,
                    "maxBOF": 0,
                    "maxEOF": 0
                }
            ],
            "no-nested-ternary": "error",
            "no-new": "error",
            "no-new-func": "error",
            "no-new-object": "error",
            "no-new-require": "error",
            "no-new-wrappers": "error",
            "no-octal": "error",
            "no-octal-escape": "error",
            "no-param-reassign": "error",
            "no-path-concat": "error",
            "no-process-exit": "error",
            "no-proto": "error",
            "no-prototype-builtins": "error",
            "no-redeclare": "error",
            "no-restricted-properties": [
                "error",
                {
                    "property": "substring",
                    "message": "Use .slice instead of .substring."
                },
                {
                    "property": "substr",
                    "message": "Use .slice instead of .substr."
                },
                {
                    "object": "assert",
                    "property": "equal",
                    "message": "Use assert.strictEqual instead of assert.equal."
                },
                {
                    "object": "assert",
                    "property": "notEqual",
                    "message": "Use assert.notStrictEqual instead of assert.notEqual."
                },
                {
                    "object": "assert",
                    "property": "deepEqual",
                    "message": "Use assert.deepStrictEqual instead of assert.deepEqual."
                },
                {
                    "object": "assert",
                    "property": "notDeepEqual",
                    "message": "Use assert.notDeepStrictEqual instead of assert.notDeepEqual."
                }
            ],
            "no-return-assign": "error",
            "no-script-url": "error",
            "no-self-assign": "error",
            "no-self-compare": "error",
            "no-sequences": "error",
            "no-shadow": "error",
            "no-shadow-restricted-names": "error",
            "no-tabs": "error",
            "no-throw-literal": "error",
            "no-trailing-spaces": "error",
            "no-undef": [
                "error",
                {
                    "typeof": true
                }
            ],
            "no-undef-init": "error",
            "no-undefined": "error",
            "no-underscore-dangle": [
                "error",
                {
                    "allowAfterThis": true
                }
            ],
            "no-unmodified-loop-condition": "error",
            "no-unneeded-ternary": "error",
            "no-unused-expressions": "error",
            "no-unused-vars": [
                "error",
                {
                    "vars": "all",
                    "args": "after-used"
                }
            ],
            "no-use-before-define": "error",
            "no-useless-call": "error",
            "no-useless-catch": "error",
            "no-useless-computed-key": "error",
            "no-useless-concat": "error",
            "no-useless-constructor": "error",
            "no-useless-escape": "error",
            "no-useless-rename": "error",
            "no-useless-return": "error",
            "no-whitespace-before-property": "error",
            "no-with": "error",
            "no-var": "error",
            "object-curly-newline": [
                "error",
                {
                    "consistent": true,
                    "multiline": true
                }
            ],
            "object-curly-spacing": [
                "error",
                "always"
            ],
            "object-property-newline": [
                "error",
                {
                    "allowAllPropertiesOnSameLine": true
                }
            ],
            "object-shorthand": "error",
            "one-var-declaration-per-line": "error",
            "operator-assignment": "error",
            "operator-linebreak": "error",
            "padding-line-between-statements": [
                "error",
                {
                    "blankLine": "always",
                    "prev": [
                        "const",
                        "let",
                        "var"
                    ],
                    "next": "*"
                },
                {
                    "blankLine": "any",
                    "prev": [
                        "const",
                        "let",
                        "var"
                    ],
                    "next": [
                        "const",
                        "let",
                        "var"
                    ]
                }
            ],
            "prefer-arrow-callback": "error",
            "prefer-const": "error",
            "prefer-numeric-literals": "error",
            "prefer-promise-reject-errors": "error",
            "prefer-rest-params": "error",
            "prefer-spread": "error",
            "prefer-template": "error",
            "quotes": [
                "error",
                "double",
                {
                    "avoidEscape": true
                }
            ],
            "quote-props": [
                "error",
                "as-needed"
            ],
            "radix": "error",
            "require-atomic-updates": "error",
            "require-jsdoc": "error",
            "rest-spread-spacing": "error",
            "semi": "error",
            "semi-spacing": [
                "error",
                {
                    "before": false,
                    "after": true
                }
            ],
            "semi-style": "error",
            "space-before-blocks": "error",
            "space-before-function-paren": [
                "error",
                "never"
            ],
            "space-in-parens": "error",
            "space-infix-ops": "error",
            "space-unary-ops": [
                "error",
                {
                    "words": true,
                    "nonwords": false
                }
            ],
            "spaced-comment": [
                "error",
                "always",
                {
                    "exceptions": [
                        "-"
                    ]
                }
            ],
            "strict": [
                "error",
                "global"
            ],
            "switch-colon-spacing": "error",
            "symbol-description": "error",
            "template-curly-spacing": [
                "error",
                "never"
            ],
            "template-tag-spacing": "error",
            "unicode-bom": "error",
            "valid-jsdoc": [
                "error",
                {
                    "prefer": {
                        "return": "returns"
                    },
                    "preferType": {
                        "String": "string",
                        "Number": "number",
                        "Boolean": "boolean",
                        "array": "Array",
                        "object": "Object",
                        "function": "Function"
                    }
                }
            ],
            "wrap-iife": "error",
            "yield-star-spacing": "error",
            "yoda": [
                "error",
                "never"
            ]
        }
    },
    {
        "name": "plugin:eslint-plugin/recommended",
        "filePath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\node_modules\\eslint-plugin-eslint-plugin\\lib\\index.js",
        "rules": {
            "eslint-plugin/fixer-return": "error",
            "eslint-plugin/no-deprecated-report-api": "error",
            "eslint-plugin/no-identical-tests": "error",
            "eslint-plugin/no-missing-placeholders": "error",
            "eslint-plugin/no-unused-placeholders": "error",
            "eslint-plugin/no-useless-token-range": "error",
            "eslint-plugin/require-meta-fixable": "error"
        }
    },
    {
        "name": ".eslintrc.js",
        "filePath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\.eslintrc.js",
        "plugins": {
            "eslint-plugin": {
                "definition": { ... },
                "filePath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\node_modules\\eslint-plugin-eslint-plugin\\lib\\index.js",
                "id": "eslint-plugin",
                "importerPath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\.eslintrc.js"
            },
            "rulesdir": {
                "definition": { ... },
                "filePath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\node_modules\\eslint-plugin-rulesdir\\index.js",
                "id": "rulesdir",
                "importerPath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\.eslintrc.js"
            }
        },
        "root": true,
        "rules": {
            "eslint-plugin/consistent-output": "error",
            "eslint-plugin/no-deprecated-context-methods": "error",
            "eslint-plugin/prefer-output-null": "error",
            "eslint-plugin/prefer-placeholders": "error",
            "eslint-plugin/report-message-format": [
                "error",
                "[^a-z].*\\.$"
            ],
            "eslint-plugin/require-meta-type": "error",
            "eslint-plugin/test-case-property-ordering": "error",
            "eslint-plugin/test-case-shorthand-strings": "error",
            "rulesdir/multiline-comment-style": "error"
        }
    },
    {
        "name": ".eslintrc.js#overrides[0]",
        "filePath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\.eslintrc.js",
        "matchFile": {
            "includes": [
                "lib/rules/*",
                "tools/internal-rules/*"
            ],
            "excludes": null
        },
        "rules": {
            "rulesdir/no-invalid-meta": "error",
            "rulesdir/consistent-docs-description": "error"
        }
    },
    {
        "name": ".eslintrc.js#overrides[1]",
        "filePath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\.eslintrc.js",
        "matchFile": {
            "includes": [
                "lib/rules/*"
            ],
            "excludes": null
        },
        "rules": {
            "rulesdir/consistent-docs-url": "error"
        }
    },
    {
        "name": ".eslintrc.js#overrides[2]",
        "filePath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\.eslintrc.js",
        "matchFile": {
            "includes": [
                "tests/**/*"
            ],
            "excludes": null
        },
        "env": {
            "mocha": true
        },
        "rules": {
            "no-restricted-syntax": [
                "error",
                {
                    "selector": "CallExpression[callee.object.name='assert'][callee.property.name='doesNotThrow']",
                    "message": "`assert.doesNotThrow()` should be replaced with a comment next to the code."
                }
            ]
        }
    }
]
```

And extract for `lib/linter.js`:

```json
{
    "env": {
        "es6": true,
        "node": true
    },
    "globals": {
        "Atomics": false,
        "SharedArrayBuffer": false
    },
    "parser": null,
    "parserOptions": {
        "ecmaVersion": 2019
    },
    "plugins": {
        "eslint-plugin": {
            "definition": { ... },
            "filePath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\node_modules\\eslint-plugin-eslint-plugin\\lib\\index.js",
            "id": "eslint-plugin",
            "importerPath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\.eslintrc.js"
        },
        "rulesdir": {
            "definition": { ... },
            "filePath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\node_modules\\eslint-plugin-rulesdir\\index.js",
            "id": "rulesdir",
            "importerPath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\.eslintrc.js"
        },
        "node": {
            "definition": { ... },
            "filePath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\node_modules\\eslint-plugin-node\\lib\\index.js",
            "id": "node",
            "importerPath": "C:\\Users\\t-nagashima.AD\\dev\\eslint\\node_modules\\eslint-plugin-node\\lib\\index.js"
        }
    },
    "processor": null,
    "rules": {
        "eslint-plugin/consistent-output": [
            "error"
        ],
        "eslint-plugin/no-deprecated-context-methods": [
            "error"
        ],
        "eslint-plugin/prefer-output-null": [
            "error"
        ],
        "eslint-plugin/prefer-placeholders": [
            "error"
        ],
        "eslint-plugin/report-message-format": [
            "error",
            "[^a-z].*\\.$"
        ],
        "eslint-plugin/require-meta-type": [
            "error"
        ],
        "eslint-plugin/test-case-property-ordering": [
            "error"
        ],
        "eslint-plugin/test-case-shorthand-strings": [
            "error"
        ],
        "rulesdir/multiline-comment-style": [
            "error"
        ],
        "eslint-plugin/fixer-return": [
            "error"
        ],
        "eslint-plugin/no-deprecated-report-api": [
            "error"
        ],
        "eslint-plugin/no-identical-tests": [
            "error"
        ],
        "eslint-plugin/no-missing-placeholders": [
            "error"
        ],
        "eslint-plugin/no-unused-placeholders": [
            "error"
        ],
        "eslint-plugin/no-useless-token-range": [
            "error"
        ],
        "eslint-plugin/require-meta-fixable": [
            "error"
        ],
        "array-bracket-spacing": [
            "error"
        ],
        "array-callback-return": [
            "error"
        ],
        "arrow-body-style": [
            "error",
            "as-needed"
        ],
        "arrow-parens": [
            "error",
            "as-needed"
        ],
        "arrow-spacing": [
            "error"
        ],
        "indent": [
            "error",
            4,
            {
                "SwitchCase": 1
            }
        ],
        "block-spacing": [
            "error"
        ],
        "brace-style": [
            "error",
            "1tbs"
        ],
        "camelcase": [
            "error"
        ],
        "callback-return": [
            "error",
            [
                "cb",
                "callback",
                "next"
            ]
        ],
        "class-methods-use-this": [
            "error"
        ],
        "comma-dangle": [
            "error"
        ],
        "comma-spacing": [
            "error"
        ],
        "comma-style": [
            "error",
            "last"
        ],
        "computed-property-spacing": [
            "error"
        ],
        "consistent-return": [
            "error"
        ],
        "curly": [
            "error",
            "all"
        ],
        "default-case": [
            "error"
        ],
        "dot-location": [
            "error",
            "property"
        ],
        "dot-notation": [
            "error",
            {
                "allowKeywords": true
            }
        ],
        "eol-last": [
            "error"
        ],
        "eqeqeq": [
            "error"
        ],
        "func-call-spacing": [
            "error"
        ],
        "func-style": [
            "error",
            "declaration"
        ],
        "function-paren-newline": [
            "error",
            "consistent"
        ],
        "generator-star-spacing": [
            "error"
        ],
        "guard-for-in": [
            "error"
        ],
        "handle-callback-err": [
            "error",
            "err"
        ],
        "key-spacing": [
            "error",
            {
                "beforeColon": false,
                "afterColon": true
            }
        ],
        "keyword-spacing": [
            "error"
        ],
        "lines-around-comment": [
            "error",
            {
                "beforeBlockComment": true,
                "afterBlockComment": false,
                "beforeLineComment": true,
                "afterLineComment": false
            }
        ],
        "max-len": [
            "error",
            160,
            {
                "ignoreComments": true,
                "ignoreUrls": true,
                "ignoreStrings": true,
                "ignoreTemplateLiterals": true,
                "ignoreRegExpLiterals": true
            }
        ],
        "max-statements-per-line": [
            "error"
        ],
        "new-cap": [
            "error"
        ],
        "new-parens": [
            "error"
        ],
        "no-alert": [
            "error"
        ],
        "no-array-constructor": [
            "error"
        ],
        "no-async-promise-executor": [
            "error"
        ],
        "no-buffer-constructor": [
            "error"
        ],
        "no-caller": [
            "error"
        ],
        "no-confusing-arrow": [
            "error"
        ],
        "no-console": [
            "error"
        ],
        "no-delete-var": [
            "error"
        ],
        "no-else-return": [
            "error",
            {
                "allowElseIf": false
            }
        ],
        "no-eval": [
            "error"
        ],
        "no-extend-native": [
            "error"
        ],
        "no-extra-bind": [
            "error"
        ],
        "no-fallthrough": [
            "error"
        ],
        "no-floating-decimal": [
            "error"
        ],
        "no-global-assign": [
            "error"
        ],
        "no-implied-eval": [
            "error"
        ],
        "no-invalid-this": [
            "error"
        ],
        "no-iterator": [
            "error"
        ],
        "no-label-var": [
            "error"
        ],
        "no-labels": [
            "error"
        ],
        "no-lone-blocks": [
            "error"
        ],
        "no-loop-func": [
            "error"
        ],
        "no-mixed-requires": [
            "error"
        ],
        "no-mixed-spaces-and-tabs": [
            "error",
            false
        ],
        "no-multi-spaces": [
            "error"
        ],
        "no-multi-str": [
            "error"
        ],
        "no-multiple-empty-lines": [
            "error",
            {
                "max": 2,
                "maxBOF": 0,
                "maxEOF": 0
            }
        ],
        "no-nested-ternary": [
            "error"
        ],
        "no-new": [
            "error"
        ],
        "no-new-func": [
            "error"
        ],
        "no-new-object": [
            "error"
        ],
        "no-new-require": [
            "error"
        ],
        "no-new-wrappers": [
            "error"
        ],
        "no-octal": [
            "error"
        ],
        "no-octal-escape": [
            "error"
        ],
        "no-param-reassign": [
            "error"
        ],
        "no-path-concat": [
            "error"
        ],
        "no-process-exit": [
            "error"
        ],
        "no-proto": [
            "error"
        ],
        "no-prototype-builtins": [
            "error"
        ],
        "no-redeclare": [
            "error"
        ],
        "no-restricted-properties": [
            "error",
            {
                "property": "substring",
                "message": "Use .slice instead of .substring."
            },
            {
                "property": "substr",
                "message": "Use .slice instead of .substr."
            },
            {
                "object": "assert",
                "property": "equal",
                "message": "Use assert.strictEqual instead of assert.equal."
            },
            {
                "object": "assert",
                "property": "notEqual",
                "message": "Use assert.notStrictEqual instead of assert.notEqual."
            },
            {
                "object": "assert",
                "property": "deepEqual",
                "message": "Use assert.deepStrictEqual instead of assert.deepEqual."
            },
            {
                "object": "assert",
                "property": "notDeepEqual",
                "message": "Use assert.notDeepStrictEqual instead of assert.notDeepEqual."
            }
        ],
        "no-return-assign": [
            "error"
        ],
        "no-script-url": [
            "error"
        ],
        "no-self-assign": [
            "error"
        ],
        "no-self-compare": [
            "error"
        ],
        "no-sequences": [
            "error"
        ],
        "no-shadow": [
            "error"
        ],
        "no-shadow-restricted-names": [
            "error"
        ],
        "no-tabs": [
            "error"
        ],
        "no-throw-literal": [
            "error"
        ],
        "no-trailing-spaces": [
            "error"
        ],
        "no-undef": [
            "error",
            {
                "typeof": true
            }
        ],
        "no-undef-init": [
            "error"
        ],
        "no-undefined": [
            "error"
        ],
        "no-underscore-dangle": [
            "error",
            {
                "allowAfterThis": true
            }
        ],
        "no-unmodified-loop-condition": [
            "error"
        ],
        "no-unneeded-ternary": [
            "error"
        ],
        "no-unused-expressions": [
            "error"
        ],
        "no-unused-vars": [
            "error",
            {
                "vars": "all",
                "args": "after-used"
            }
        ],
        "no-use-before-define": [
            "error"
        ],
        "no-useless-call": [
            "error"
        ],
        "no-useless-catch": [
            "error"
        ],
        "no-useless-computed-key": [
            "error"
        ],
        "no-useless-concat": [
            "error"
        ],
        "no-useless-constructor": [
            "error"
        ],
        "no-useless-escape": [
            "error"
        ],
        "no-useless-rename": [
            "error"
        ],
        "no-useless-return": [
            "error"
        ],
        "no-whitespace-before-property": [
            "error"
        ],
        "no-with": [
            "error"
        ],
        "no-var": [
            "error"
        ],
        "object-curly-newline": [
            "error",
            {
                "consistent": true,
                "multiline": true
            }
        ],
        "object-curly-spacing": [
            "error",
            "always"
        ],
        "object-property-newline": [
            "error",
            {
                "allowAllPropertiesOnSameLine": true
            }
        ],
        "object-shorthand": [
            "error"
        ],
        "one-var-declaration-per-line": [
            "error"
        ],
        "operator-assignment": [
            "error"
        ],
        "operator-linebreak": [
            "error"
        ],
        "padding-line-between-statements": [
            "error",
            {
                "blankLine": "always",
                "prev": [
                    "const",
                    "let",
                    "var"
                ],
                "next": "*"
            },
            {
                "blankLine": "any",
                "prev": [
                    "const",
                    "let",
                    "var"
                ],
                "next": [
                    "const",
                    "let",
                    "var"
                ]
            }
        ],
        "prefer-arrow-callback": [
            "error"
        ],
        "prefer-const": [
            "error"
        ],
        "prefer-numeric-literals": [
            "error"
        ],
        "prefer-promise-reject-errors": [
            "error"
        ],
        "prefer-rest-params": [
            "error"
        ],
        "prefer-spread": [
            "error"
        ],
        "prefer-template": [
            "error"
        ],
        "quotes": [
            "error",
            "double",
            {
                "avoidEscape": true
            }
        ],
        "quote-props": [
            "error",
            "as-needed"
        ],
        "radix": [
            "error"
        ],
        "require-atomic-updates": [
            "error"
        ],
        "require-jsdoc": [
            "error"
        ],
        "rest-spread-spacing": [
            "error"
        ],
        "semi": [
            "error"
        ],
        "semi-spacing": [
            "error",
            {
                "before": false,
                "after": true
            }
        ],
        "semi-style": [
            "error"
        ],
        "space-before-blocks": [
            "error"
        ],
        "space-before-function-paren": [
            "error",
            "never"
        ],
        "space-in-parens": [
            "error"
        ],
        "space-infix-ops": [
            "error"
        ],
        "space-unary-ops": [
            "error",
            {
                "words": true,
                "nonwords": false
            }
        ],
        "spaced-comment": [
            "error",
            "always",
            {
                "exceptions": [
                    "-"
                ]
            }
        ],
        "strict": [
            "error",
            "global"
        ],
        "switch-colon-spacing": [
            "error"
        ],
        "symbol-description": [
            "error"
        ],
        "template-curly-spacing": [
            "error",
            "never"
        ],
        "template-tag-spacing": [
            "error"
        ],
        "unicode-bom": [
            "error"
        ],
        "valid-jsdoc": [
            "error",
            {
                "prefer": {
                    "return": "returns"
                },
                "preferType": {
                    "String": "string",
                    "Number": "number",
                    "Boolean": "boolean",
                    "array": "Array",
                    "object": "Object",
                    "function": "Function"
                }
            }
        ],
        "wrap-iife": [
            "error"
        ],
        "yield-star-spacing": [
            "error"
        ],
        "yoda": [
            "error",
            "never"
        ],
        "node/exports-style": [
            "off"
        ],
        "node/no-deprecated-api": [
            "error"
        ],
        "node/no-extraneous-import": [
            "off"
        ],
        "node/no-extraneous-require": [
            "error"
        ],
        "node/no-missing-import": [
            "off"
        ],
        "node/no-missing-require": [
            "error"
        ],
        "node/no-unpublished-bin": [
            "error"
        ],
        "node/no-unpublished-import": [
            "off"
        ],
        "node/no-unpublished-require": [
            "error"
        ],
        "node/no-unsupported-features/es-builtins": [
            "error"
        ],
        "node/no-unsupported-features/es-syntax": [
            "error"
        ],
        "node/no-unsupported-features/node-builtins": [
            "error"
        ],
        "node/prefer-global/buffer": [
            "off"
        ],
        "node/prefer-global/console": [
            "off"
        ],
        "node/prefer-global/process": [
            "off"
        ],
        "node/prefer-global/text-decoder": [
            "off"
        ],
        "node/prefer-global/text-encoder": [
            "off"
        ],
        "node/prefer-global/url-search-params": [
            "off"
        ],
        "node/prefer-global/url": [
            "off"
        ],
        "node/process-exit-as-throw": [
            "error"
        ],
        "node/shebang": [
            "error"
        ],
        "accessor-pairs": [
            "off"
        ],
        "array-bracket-newline": [
            "off"
        ],
        "array-element-newline": [
            "off"
        ],
        "block-scoped-var": [
            "off"
        ],
        "capitalized-comments": [
            "off"
        ],
        "complexity": [
            "off"
        ],
        "consistent-this": [
            "off"
        ],
        "constructor-super": [
            "error"
        ],
        "for-direction": [
            "error"
        ],
        "func-name-matching": [
            "off"
        ],
        "func-names": [
            "off"
        ],
        "getter-return": [
            "error"
        ],
        "global-require": [
            "off"
        ],
        "id-blacklist": [
            "off"
        ],
        "id-length": [
            "off"
        ],
        "id-match": [
            "off"
        ],
        "implicit-arrow-linebreak": [
            "off"
        ],
        "indent-legacy": [
            "off"
        ],
        "init-declarations": [
            "off"
        ],
        "jsx-quotes": [
            "off"
        ],
        "line-comment-position": [
            "off"
        ],
        "linebreak-style": [
            "off"
        ],
        "lines-around-directive": [
            "off"
        ],
        "lines-between-class-members": [
            "off"
        ],
        "max-classes-per-file": [
            "off"
        ],
        "max-depth": [
            "off"
        ],
        "max-lines": [
            "off"
        ],
        "max-lines-per-function": [
            "off"
        ],
        "max-nested-callbacks": [
            "off"
        ],
        "max-params": [
            "off"
        ],
        "max-statements": [
            "off"
        ],
        "multiline-comment-style": [
            "off"
        ],
        "multiline-ternary": [
            "off"
        ],
        "newline-after-var": [
            "off"
        ],
        "newline-before-return": [
            "off"
        ],
        "newline-per-chained-call": [
            "off"
        ],
        "no-await-in-loop": [
            "off"
        ],
        "no-bitwise": [
            "off"
        ],
        "no-case-declarations": [
            "error"
        ],
        "no-catch-shadow": [
            "off"
        ],
        "no-class-assign": [
            "error"
        ],
        "no-compare-neg-zero": [
            "error"
        ],
        "no-cond-assign": [
            "error"
        ],
        "no-const-assign": [
            "error"
        ],
        "no-constant-condition": [
            "error"
        ],
        "no-continue": [
            "off"
        ],
        "no-control-regex": [
            "error"
        ],
        "no-debugger": [
            "error"
        ],
        "no-div-regex": [
            "off"
        ],
        "no-dupe-args": [
            "error"
        ],
        "no-dupe-class-members": [
            "error"
        ],
        "no-dupe-keys": [
            "error"
        ],
        "no-duplicate-case": [
            "error"
        ],
        "no-duplicate-imports": [
            "off"
        ],
        "no-empty": [
            "error"
        ],
        "no-empty-character-class": [
            "error"
        ],
        "no-empty-function": [
            "off"
        ],
        "no-empty-pattern": [
            "error"
        ],
        "no-eq-null": [
            "off"
        ],
        "no-ex-assign": [
            "error"
        ],
        "no-extra-boolean-cast": [
            "error"
        ],
        "no-extra-label": [
            "off"
        ],
        "no-extra-parens": [
            "off"
        ],
        "no-extra-semi": [
            "error"
        ],
        "no-func-assign": [
            "error"
        ],
        "no-implicit-coercion": [
            "off"
        ],
        "no-implicit-globals": [
            "off"
        ],
        "no-inline-comments": [
            "off"
        ],
        "no-inner-declarations": [
            "error"
        ],
        "no-invalid-regexp": [
            "error"
        ],
        "no-irregular-whitespace": [
            "error"
        ],
        "no-lonely-if": [
            "off"
        ],
        "no-magic-numbers": [
            "off"
        ],
        "no-misleading-character-class": [
            "off"
        ],
        "no-mixed-operators": [
            "off"
        ],
        "no-multi-assign": [
            "off"
        ],
        "no-native-reassign": [
            "off"
        ],
        "no-negated-condition": [
            "off"
        ],
        "no-negated-in-lhs": [
            "off"
        ],
        "no-new-symbol": [
            "error"
        ],
        "no-obj-calls": [
            "error"
        ],
        "no-plusplus": [
            "off"
        ],
        "no-process-env": [
            "off"
        ],
        "no-regex-spaces": [
            "error"
        ],
        "no-restricted-globals": [
            "off"
        ],
        "no-restricted-imports": [
            "off"
        ],
        "no-restricted-modules": [
            "off"
        ],
        "no-restricted-syntax": [
            "off"
        ],
        "no-return-await": [
            "off"
        ],
        "no-spaced-func": [
            "off"
        ],
        "no-sparse-arrays": [
            "error"
        ],
        "no-sync": [
            "off"
        ],
        "no-template-curly-in-string": [
            "off"
        ],
        "no-ternary": [
            "off"
        ],
        "no-this-before-super": [
            "error"
        ],
        "no-unexpected-multiline": [
            "error"
        ],
        "no-unreachable": [
            "error"
        ],
        "no-unsafe-finally": [
            "error"
        ],
        "no-unsafe-negation": [
            "error"
        ],
        "no-unused-labels": [
            "error"
        ],
        "no-void": [
            "off"
        ],
        "no-warning-comments": [
            "off"
        ],
        "nonblock-statement-body-position": [
            "off"
        ],
        "one-var": [
            "off"
        ],
        "padded-blocks": [
            "off"
        ],
        "prefer-destructuring": [
            "off"
        ],
        "prefer-object-spread": [
            "off"
        ],
        "prefer-reflect": [
            "off"
        ],
        "require-await": [
            "off"
        ],
        "require-unicode-regexp": [
            "off"
        ],
        "require-yield": [
            "error"
        ],
        "sort-imports": [
            "off"
        ],
        "sort-keys": [
            "off"
        ],
        "sort-vars": [
            "off"
        ],
        "use-isnan": [
            "error"
        ],
        "valid-typeof": [
            "error"
        ],
        "vars-on-top": [
            "off"
        ],
        "wrap-regex": [
            "off"
        ]
    },
    "settings": {}
}
```

</details>

## About async version

We can make `async` version easily from this module.

- Change `fs` APIs to the promise version.
- Use `await` and `for-await-of` syntax.

That's all, thought it needs Node.js 10.0.0.
