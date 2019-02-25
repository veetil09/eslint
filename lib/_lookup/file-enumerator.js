/**
 * @fileoverview Enumerate target files.
 *
 * Because every directory can have a config file that changes target files,
 * the file enumerator searches files as loading the config files when entered
 * each directory.
 *
 * When a target file was found, the file enumerator yields the tuple of the
 * path to the file, the config of the file, and the ignoring flag.
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const getGlobParent = require("glob-parent");
const { escapeRegExp } = require("lodash");
const { Minimatch } = require("minimatch");
const ConfigArrayFactory = require("./config-array-factory");
const debug = require("debug")("eslint:file-enumerator");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const minimatchOpts = { dot: true, matchBase: true };

/**
 * @typedef {Object} FileEnumeratorOptions
 * @property {ConfigData} [baseConfig] The config by `baseConfig` option.
 * @property {ConfigData} [cliConfig] The config by CLI options. This is prior to regular config files.
 * @property {string} [cwd] The base directory to start lookup.
 * @property {string[]} [extensions] The extensions to match files for directory patterns.
 * @property {boolean} [ignore] The flag to check ignored files.
 * @property {IgnoredPaths} [ignoredPaths] The ignored paths.
 * @property {string} [specificConfigPath] The value of `--config` option.
 * @property {boolean} [useEslintrc] if `false` then it doesn't load config files.
 */

/**
 * @typedef {Object} FileAndConfig
 * @property {string} filePath The path to a target file.
 * @property {ConfigArray} config The config entries of that file.
 * @property {"Ignored"|"Warning"|null} flag The flag.
 * - `"Ignored"` means the file should be ignored silently.
 * - `"Warning"` means the file should be ignored and warned because it was directly specified.
 */

/**
 * Get stats of a given path.
 * @param {string} filePath The path to target file.
 * @returns {fs.Stats|null} The stats.
 * @private
 */
function getStat(filePath) {
    try {
        return fs.statSync(filePath);
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }
        return null;
    }
}

/**
 * This class provides the functionality that enumerates every file which is
 * matched by given glob patterns and that configuration.
 * @private
 */
class FileEnumerator {

    /**
     * Initialize this enumerator.
     * @param {FileEnumeratorOptions} options The options.
     */
    constructor({
        baseConfig = null,
        cliConfig = null,
        cwd = process.cwd(),
        extensions = [".js"],
        ignore = true,
        ignoredPaths = null,
        specificConfigPath = null,
        useEslintrc = true
    } = {}) {

        /**
         * @type {ConfigArray}
         * @private
         */
        this.baseConfigArray = ConfigArrayFactory.create(
            baseConfig,
            { filePath: path.join(cwd, ".baseconfig") }
        );

        /**
         * @type {ConfigData}
         * @private
         */
        this.cliConfigData = cliConfig;

        /**
         * @type {string}
         * @private
         */
        this.cwd = cwd;

        /**
         * @type {RegExp}
         * @private
         */
        this.extRegExp = new RegExp(
            `.\\.(?:${extensions
                .map(ext => escapeRegExp(
                    ext.startsWith(".")
                        ? ext.slice(1)
                        : ext
                ))
                .join("|")
            })$`,
            "u"
        );

        /**
         * @type {boolean|null}
         * @private
         */
        this.ignore = ignore;

        /**
         * @type {IgnoredPaths|null}
         * @private
         */
        this.ignoredPaths = ignoredPaths;

        /**
         * @type {string|null}
         * @private
         */
        this.specificConfigPath = specificConfigPath;

        /**
         * @type {boolean}
         * @private
         */
        this.useEslintrc = useEslintrc;

        /**
         * @type {boolean}
         * @private
         */
        this.usePersonalEslintrc = !specificConfigPath;

        /**
         * @type {WeakMap<ConfigArray, ConfigArray>}
         * @private
         */
        this.cache = new WeakMap();
    }

    /**
     * Iterate files which are matched by given glob patterns.
     * @param {string[]} patterns The glob patterns to iterate files.
     * @returns {IterableIterator<FileAndConfig>} The found files.
     */
    *iterateFiles(patterns) {
        if (!Array.isArray(patterns)) {
            patterns = [patterns]; // eslint-disable-line no-param-reassign
        }

        debug(`Start to iterate files: ${JSON.stringify(patterns)}`);

        for (const pattern of patterns) {
            const absolutePath = path.resolve(this.cwd, pattern);
            const stat = getStat(absolutePath);

            if (stat === null) {
                yield* this.iterateFilesWithGlob(pattern);
            } else if (stat.isDirectory()) {
                yield* this.iterateFilesInDirectory(absolutePath);
            } else if (stat.isFile()) {
                yield* this.iterateFilesAtFile(absolutePath);
            }
        }

        debug(`Complete iterating files: ${JSON.stringify(patterns)}`);
    }

    /**
     * Iterate a file which is matched by a given path.
     * @param {string} filePath The path to the target file.
     * @returns {IterableIterator<FileAndConfig>} The found files.
     * @private
     */
    iterateFilesAtFile(filePath) {
        debug(`File: ${filePath}`);

        const config = this.loadConfigInAncestors(filePath);
        const ignored = this.isIgnoredFile(filePath);

        return [{
            config: this.finalizeConfigArray(config),
            filePath,
            flag: ignored ? "Warning" : null
        }];
    }

    /**
     * Iterate files in a given path.
     * @param {string} directoryPath The path to the target directory.
     * @returns {IterableIterator<FileAndConfig>} The found files.
     * @private
     */
    iterateFilesInDirectory(directoryPath) {
        debug(`Directory: ${directoryPath}`);

        return this.iterateFilesInDirectoryRecursive(
            directoryPath,
            this.loadConfigInAncestors(directoryPath),
            null,
            true
        );
    }

    /**
     * Iterate files which are matched by a given glob pattern.
     * @param {string} pattern The glob pattern to iterate files.
     * @param {IterateFileOptions} options The options to iterate files.
     * @returns {IterableIterator<FileAndConfig>} The found files.
     * @private
     */
    iterateFilesWithGlob(pattern) {
        debug(`Glob: ${pattern}`);

        const globParent = getGlobParent(pattern);
        const directoryPath = path.resolve(this.cwd, globParent);
        const config = this.loadConfigInAncestors(directoryPath);
        const selector = new Minimatch(pattern, minimatchOpts);
        const globPart = pattern.slice(globParent.length + 1);
        const recursive = globParent === "." || /\*\*|\/|\\/u.test(globPart);

        debug(`recursive? ${recursive}`);

        return this.iterateFilesInDirectoryRecursive(
            directoryPath,
            config,
            selector,
            recursive
        );
    }

    /**
     * Iterate files in a given path.
     * @param {string} directoryPath The path to the target directory.
     * @param {ConfigArray} parentConfig The options to iterate files.
     * @param {Minimatch|null} [selector] The matcher to choose files.
     * @param {boolean} [recursive] The matcher to choose files.
     * @returns {IterableIterator<FileAndConfig>} The found files.
     * @private
     */
    *iterateFilesInDirectoryRecursive(
        directoryPath,
        parentConfig,
        selector,
        recursive
    ) {
        debug(`Enter the directory: ${directoryPath}`);

        /*
         * Load a config file such as `.eslintrc` on this directory and merge
         * with the parent configuration.
         * If there are no config files here, `config === parentConfig`.
         */
        const config = this.loadConfigOnDirectory(
            directoryPath,
            parentConfig
        );

        // Enumerate the files of this directory.
        for (const filename of fs.readdirSync(directoryPath)) {
            const filePath = path.join(directoryPath, filename);
            const ignored = this.isIgnoredFile(filePath);
            const stat = fs.statSync(filePath); // Use `withFileTypes` in the future.

            if (ignored) {
                debug(`Ignored: ${filename}`);
            }

            // Check if the file is matched.
            if (stat.isFile()) {
                const relPath = path.relative(this.cwd, filePath);
                const matched = selector
                    ? selector.match(relPath)

                    // Match by extensions or the `files` property of the current config.
                    : this.extRegExp.test(relPath) || config.matchFile(relPath);

                if (matched) {
                    yield {
                        config: this.finalizeConfigArray(config),
                        filePath,
                        flag: ignored ? "Ignored" : null
                    };
                }

            // Dive into the sub directory.
            } else if (stat.isDirectory() && recursive && !ignored) {
                yield* this.iterateFilesInDirectoryRecursive(
                    filePath,
                    config,
                    selector,
                    recursive
                );
            }
        }

        debug(`Leave the directory: ${directoryPath}`);
    }

    /**
     * Check if a given file should be ignored.
     * @param {string} filePath The path to a file to check.
     * @returns {boolean} `true` if the file should be ignored.
     * @private
     */
    isIgnoredFile(filePath) {
        return (
            this.ignore !== false &&
            this.ignoredPaths !== null &&
            (
                this.ignoredPaths.contains(filePath, "default") ||
                this.ignoredPaths.contains(filePath, "custom")
            )
        );
    }

    /**
     * Load and normalize config files from the ancestor directories.
     * @param {string} directoryPath The path to a leaf directory.
     * @returns {ConfigArray} The loaded config.
     * @private
     */
    loadConfigInAncestors(directoryPath) {
        if (this.useEslintrc) {
            return ConfigArrayFactory.loadInAncestors(
                directoryPath,
                {
                    parent: this.baseConfigArray,
                    usePersonalEslintrc: this.usePersonalEslintrc
                }
            );
        }
        return this.baseConfigArray;
    }

    /**
     * Load and normalize config files from a given directory.
     * @param {string} directoryPath The path to the directory to load.
     * @param {ConfigArray} parentConfigArray The parent config array.
     * @returns {ConfigArray} The loaded config.
     * @private
     */
    loadConfigOnDirectory(directoryPath, parentConfigArray) {
        if (this.useEslintrc) {
            return ConfigArrayFactory.loadOnDirectory(
                directoryPath,
                { parent: parentConfigArray }
            );
        }
        return this.baseConfigArray;
    }

    /**
     * Finalize a given config array.
     * Concatinate `--config` and other CLI options.
     * @param {ConfigArray} parentConfigArray The parent config array.
     * @returns {ConfigArray} The loaded config.
     * @private
     */
    finalizeConfigArray(parentConfigArray) {
        let finalConfigArray = this.cache.get(parentConfigArray);

        if (!finalConfigArray) {

            // `--config`
            const specificConfigArray = this.specificConfigPath
                ? ConfigArrayFactory.loadFile(
                    this.specificConfigPath,
                    { parent: parentConfigArray }
                )
                : parentConfigArray;

            // others
            finalConfigArray = ConfigArrayFactory.create(
                this.cliConfigData,
                {
                    filePath: path.join(this.cwd, ".clioptions"),
                    parent: specificConfigArray
                }
            );

            this.cache.set(parentConfigArray, finalConfigArray);
        }

        return finalConfigArray;
    }
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

module.exports = FileEnumerator;
