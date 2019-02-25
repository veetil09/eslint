# Lookup module

This module provides the way to find files and configs.

- [`FileEnumerator`](./file-enumerator.js) ... enumerates files which are matched by given glob patterns as loading config files. When it entered into a directory, (1) reads the config file on the directory, then (2) enumerates files on the directory. Therefore, it can use the config data in order to choose enumerated files.

- [`ConfigArrayFactory`](./config-array-factory.js) ... finds config files and resolve those dependencies recursively. All `extends` properties and `overrides` properties are flattened to one array. This doesn't register the loaded plugins/parsers to anywhere. Instead, the config instance itself has the entity of the loaded plugins/parsers.

- [`ConfigArray`](./config-array.js) ... is the configuration object. `ConfigArray#extractConfig(filePath)` method filters the element in this array by `files` and `excludedFiles`, then merge those to one object.

- [`IgnoredPaths`](./ignored-paths.js) ... is as is. `FileEnumerator` uses it to ignore large directories such as `node_modules`.

## Usage

Basic usage is:

```js
"use strict"

const { FileEnumerator, IgnoredPaths } = require("./lookup")
const Linter = require("./linter")
const linter = new Linter()

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

    // Do lint!
    const messages = linter.verify(
        fs.readFileSync(filePath, "utf8"),
        config,
        filePath
    )

    console.log(messages)
}
```

See also: https://github.com/eslint/rfcs/blob/eslintrc-improvements/designs/2019-eslintrc-improvements/README.md
