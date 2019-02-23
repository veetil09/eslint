/**
 * @fileoverview define `ConfigArray` to operate the array.
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const os = require("os");
const path = require("path");
const { extractConfig } = require("./config-array-extract");
const {
    loadConfigData,
    loadConfigDataOnDirectory,
    normalizeConfigData
} = require("./config-array-load");
const debug = require("debug")("eslint:config-array");

/**
 * @typedef {Object} ConfigData
 * @property {boolean} [root] The root flag.
 * @property {ConfigOverrideData[]} [overrides] The override settings per kind of files.
 * @property {string} [extends] The path to other config files or the package name of shareable configs.
 * @property {string} [parser] The path to a parser or the package name of a parser.
 * @property {Object} [parserOptions] The parser options.
 * @property {string[]} [plugins] The plugin specifiers.
 * @property {string} [processor] The named pre/post processor specifier.
 * @property {Object} [env] The environment settings.
 * @property {Object} [globals] The global variable settings.
 * @property {Object} [rules] The rule settings.
 * @property {Object} [settings] The shared settings.
 */

/**
 * @typedef {Object} ConfigOverrideData
 * @property {string|string[]} files The glob pattarns for target files.
 * @property {string|string[]} [excludedFiles] The glob pattarns for excluded files.
 * @property {string} [extends] The path to other config files or the package name of shareable configs.
 * @property {string} [parser] The path to a parser or the package name of a parser.
 * @property {Object} [parserOptions] The parser options.
 * @property {string[]} [plugins] The plugin specifiers.
 * @property {string} [processor] The named pre/post processor specifier.
 * @property {Object} [env] The environment settings.
 * @property {Object} [globals] The global variable settings.
 * @property {Object} [rules] The rule settings.
 * @property {Object} [settings] The shared settings.
 */

/**
 * @typedef {Object} ConfigEntry
 * @property {string} [name] The name of this entry.
 * @property {string} [filePath] The path to the config file where this config came from.
 * @property {(relativePath:string) => boolean} [matchFile] the test function to check if a relative path should use this config entry.
 * @property {boolean} [root] The root flag.
 * @property {Object|null} [parser] The path to a parser or the package name of a parser.
 * @property {Object} [parserOptions] The parser options.
 * @property {Object} [plugins] The plugin specifiers.
 * @property {Object|null} [processor] The named pre/post processor specifier.
 * @property {Object} [globals] The global variable settings.
 * @property {Object} [rules] The rule settings.
 * @property {Object} [settings] The shared settings.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Concatenate two config data.
 * @param {IterableIterator<ConfigEntry>|null} entries The entries.
 * @param {ConfigArray|null} parentConfigArray The parent config array.
 * @returns {ConfigArray} The concatenated config array.
 */
function create(entries, parentConfigArray) {
    if (!entries) {
        return parentConfigArray || new ConfigArray(); // eslint-disable-line no-use-before-define
    }

    const configArray = new ConfigArray(...entries); // eslint-disable-line no-use-before-define

    if (parentConfigArray && !configArray.isRoot()) {
        configArray.unshift(...parentConfigArray);
    }
    return configArray;
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * The Config Array.
 *
 * This class provides static methods to create `ConfigArray` instance.
 *
 * - `ConfigArray.create()`
 *     Create an instance from a config data. This is to handle CLIOptions.
 * - `ConfigArray.loadFile()`
 *     Create an instance from a config file. This is to handle `--config`
 *     option.
 * - `ConfigArray.loadOnDirectory()`
 *     Create an instance from a config file which is on a given directory. This
 *     tries to load `.eslintrc.*` or `package.json`. If not found, returns
 *     `null`.
 * - `ConfigArray.loadInAncestors()`
 *     Create an instance from config files which is in the ancestor directries
 *     of a given directory. This tries to load `.eslintrc.*` or `package.json`.
 *     If not found, returns `null`.
 *
 * `ConfigArray` instance contains all settings, parsers, and plugins.
 * You need to call `ConfigArray#extractConfig(filePath)` method in order to
 * extract, merge and get only the config data which is related to an arbitrary
 *  file.
 */
class ConfigArray extends Array {

    /**
     * Create `ConfigArray` instance from a config data.
     * @param {ConfigData|null} configData The path to a directory.
     * @param {Object} [options] The options.
     * @param {string} [options.filePath] The path to this config data.
     * @param {string} [options.name] The config name.
     * @param {ConfigArray} [options.parent] The parent config array.
     * @returns {ConfigArray} Loaded config.
     */
    static create(configData, { filePath, name, parent } = {}) {
        return create(
            configData
                ? normalizeConfigData(configData, { filePath, name })
                : null,
            parent
        );
    }

    /**
     * Load a config file.
     * @param {string} filePath The path to a config file.
     * @param {Object} [options] The options.
     * @param {string} [options.name] The config name.
     * @param {ConfigArray} [options.parent] The parent config array.
     * @returns {ConfigArray|null} Loaded config.
     */
    static loadFile(filePath, { name, parent } = {}) {
        return create(loadConfigData(filePath, { name }), parent);
    }

    /**
     * Load the config file on a given directory if exists.
     * @param {string} directoryPath The path to a directory.
     * @param {Object} [options] The options.
     * @param {string} [options.name] The config name.
     * @param {ConfigArray} [options.parent] The parent config array.
     * @returns {ConfigArray|null} Loaded config. `null` if any config doesn't exist.
     */
    static loadOnDirectory(directoryPath, { name, parent } = {}) {
        return create(
            loadConfigDataOnDirectory(directoryPath, { name }),
            parent
        );
    }

    /**
     * Load config files in the ancestors of a given directory.
     *
     * For example, when `/path/to/a/dir` was given, it checks `/path/to/a`,
     * `/path/to`, `/path`, and `/`.
     * If `root:true` was found in the middle then it stops the check.
     *
     * @param {string} directoryPath The path to start.
     * @param {Object} [options] The options.
     * @param {ConfigArray} [options.parent] The parent config array.
     * @param {boolean} [options.usePersonalEslintrc] The flag to use config on the home directory.
     * @returns {ConfigArray} The loaded config.
     * @private
     */
    static loadInAncestors(
        directoryPath,
        { parent = null, usePersonalEslintrc = true } = {}
    ) {
        debug("Loading config files in ancestor directories.");

        const configArray = new ConfigArray(...(parent || []));
        let prevPath = directoryPath;
        let currentPath = path.dirname(directoryPath);

        // Load regular config files.
        do {
            let directoryConfig;

            try {
                directoryConfig = loadConfigDataOnDirectory(currentPath);
            } catch (error) {
                if (error.code === "EACCES" || error.code === "EPERM") {
                    debug(`Stop traversing because of ${error.code}.`);
                    break;
                }
                throw error;
            }

            // Merge.
            if (directoryConfig) {
                const array = new ConfigArray(...directoryConfig);

                configArray.unshift(...array);

                // Stop if it's root.
                if (array.isRoot()) {
                    break;
                }
            }

            prevPath = currentPath;
            currentPath = path.dirname(currentPath);
        } while (currentPath && currentPath !== prevPath);

        // Load the personal config file if there are no regular files. TODO: specificConfig
        if (configArray.length === 0 && usePersonalEslintrc) {
            debug("Loading config files in the home directory.");

            const personalConfig = loadConfigDataOnDirectory(os.homedir());

            if (personalConfig) {
                configArray.unshift(...personalConfig);
            }
        }

        debug("Loaded config files in ancestor directories.");
        return configArray;
    }

    /**
     * Check if this config has `root` flag.
     * @returns {boolean} `true` if this config has `root` flag.
     */
    isRoot() {
        for (let i = this.length - 1; i >= 0; --i) {
            const root = this[i].root;

            if (typeof root === "boolean") {
                return root;
            }
        }
        return false;
    }

    /**
     * Check if a given path is matched by this config's `files` property.
     * @param {string} relativePath The relative path to a file to check.
     * @returns {boolean} `true` if matched or there are no entries which have
     * `files` property.
     */
    matchFile(relativePath) {
        for (const entry of this) {
            if (entry.matchFile) {
                if (entry.matchFile(relativePath)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Extract the config data which is related to a given file.
     * @param {string} targetFilePath The relative path to the target file.
     * @returns {ExtractedConfigData} The extracted config data.
     */
    extractConfig(targetFilePath) {
        return extractConfig(this, targetFilePath);
    }
}

module.exports = ConfigArray;
