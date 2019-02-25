/**
 * @fileoverview newly CLIEngine.
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { cloneDeep } = require("lodash");
const DefaultOptions = require("../../conf/default-cli-options");
const ConfigValidator = require("../config/config-validator");
const Linter = require("../linter");
const {
    ConfigArrayFactory,
    FileEnumerator,
    IgnoredPaths,
    loadFormatter
} = require("../_lookup");
const hash = require("./hash");
const LintResultCache = require("./lint-result-cache");
const loadRules = require("./load-rules");
const debug = require("debug")("eslint:cli-engine");

/**
 * The options to configure a CLI engine with.
 * @typedef {Object} CLIEngineOptions
 * @property {boolean} allowInlineConfig Enable or disable inline configuration comments.
 * @property {Object} baseConfig Base config object, extended by all configs used with this CLIEngine instance
 * @property {boolean} cache Enable result caching.
 * @property {string} cacheLocation The cache file to use instead of .eslintcache.
 * @property {string} configFile The configuration file to use.
 * @property {string} cwd The value to use for the current working directory.
 * @property {string[]} envs An array of environments to load.
 * @property {string[]} extensions An array of file extensions to check.
 * @property {boolean|Function} fix Execute in autofix mode. If a function, should return a boolean.
 * @property {string[]} fixTypes Array of rule types to apply fixes for.
 * @property {string[]} globals An array of global variables to declare.
 * @property {boolean} ignore False disables use of .eslintignore.
 * @property {string} ignorePath The ignore file to use instead of .eslintignore.
 * @property {string} ignorePattern A glob pattern of files to ignore.
 * @property {boolean} useEslintrc False disables looking for .eslintrc
 * @property {string} parser The name of the parser to use.
 * @property {Object} parserOptions An object of parserOption settings to use.
 * @property {string[]} plugins An array of plugins to load.
 * @property {Object<string,*>} rules An object of rules to use.
 * @property {string[]} rulePaths An array of directories to load custom rules from.
 * @property {boolean} reportUnusedDisableDirectives `true` adds reports for unused eslint-disable directives
 */

/**
 * A linting warning or error.
 * @typedef {Object} LintMessage
 * @property {string} message The message to display to the user.
 */

/**
 * A linting result.
 * @typedef {Object} LintResult
 * @property {string} filePath The path to the file that was linted.
 * @property {LintMessage[]} messages All of the messages for the result.
 * @property {number} errorCount Number of errors for the result.
 * @property {number} warningCount Number of warnings for the result.
 * @property {number} fixableErrorCount Number of fixable errors for the result.
 * @property {number} fixableWarningCount Number of fixable warnings for the result.
 * @property {string=} [source] The source code of the file that was linted.
 * @property {string=} [output] The source code of the file that was linted, with as many fixes applied as possible.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const validFixTypes = new Set(["problem", "suggestion", "layout"]);

/**
 * Determines if each fix type in an array is supported by ESLint and throws
 * an error if not.
 * @param {string[]} fixTypes An array of fix types to check.
 * @returns {void}
 * @throws {Error} If an invalid fix type is found.
 */
function validateFixTypes(fixTypes) {
    for (const fixType of fixTypes) {
        if (!validFixTypes.has(fixType)) {
            throw new Error(`Invalid fix type "${fixType}" found.`);
        }
    }
}

/**
 * Convert a string array to a boolean map.
 * @param {string[]|null} keys The keys to assign true.
 * @param {string} displayName The property name which is used in error message.
 * @returns {Record<string,boolean>} The boolean map.
 */
function toBooleanMap(keys, displayName) {
    if (keys && !Array.isArray(keys)) {
        throw new Error(`${displayName} must be an array.`);
    }
    if (keys && keys.length > 0) {
        return keys.reduce((map, key) => {
            if (key !== "__proto__") {
                map[key] = true;
            }
            return map;
        }, {});
    }
    return void 0;
}

/**
 * Create a config data from CLI options.
 * @param {CLIEngineOptions} options The options
 * @returns {ConfigData|null} The created config data.
 */
function createConfigDataFromOptions(options) {
    const { parser, parserOptions, plugins, rules } = options;
    const env = toBooleanMap(options.envs, "envs");
    const globals = toBooleanMap(options.globals, "globals");

    if (
        env === void 0 &&
        globals === void 0 &&
        parser === void 0 &&
        parserOptions === void 0 &&
        plugins === void 0 &&
        rules === void 0
    ) {
        return null;
    }
    return { env, globals, parser, parserOptions, plugins, rules };
}

/**
 * return the cacheFile to be used by eslint, based on whether the provided parameter is
 * a directory or looks like a directory (ends in `path.sep`), in which case the file
 * name will be the `cacheFile/.cache_hashOfCWD`
 *
 * if cacheFile points to a file or looks like a file then in will just use that file
 *
 * @param {string} cacheFile The name of file to be used to store the cache
 * @param {string} cwd Current working directory
 * @returns {string} the resolved path to the cache file
 */
function normalizeCacheFilePath(cacheFile, cwd) {

    /*
     * make sure the path separators are normalized for the environment/os
     * keeping the trailing path separator if present
     */
    const normalizedCacheFile = path.normalize(cacheFile);

    const resolvedCacheFile = path.resolve(cwd, normalizedCacheFile);
    const looksLikeADirectory = normalizedCacheFile.slice(-1) === path.sep;

    /**
     * return the name for the cache file in case the provided parameter is a directory
     * @returns {string} the resolved path to the cacheFile
     */
    function getCacheFileForDirectory() {
        return path.join(resolvedCacheFile, `.cache_${hash(cwd)}`);
    }

    let fileStats;

    try {
        fileStats = fs.lstatSync(resolvedCacheFile);
    } catch (ex) {
        fileStats = null;
    }


    /*
     * in case the file exists we need to verify if the provided path
     * is a directory or a file. If it is a directory we want to create a file
     * inside that directory
     */
    if (fileStats) {

        /*
         * is a directory or is a file, but the original file the user provided
         * looks like a directory but `path.resolve` removed the `last path.sep`
         * so we need to still treat this like a directory
         */
        if (fileStats.isDirectory() || looksLikeADirectory) {
            return getCacheFileForDirectory();
        }

        // is file so just use that file
        return resolvedCacheFile;
    }

    /*
     * here we known the file or directory doesn't exist,
     * so we will try to infer if its a directory if it looks like a directory
     * for the current operating system.
     */

    // if the last character passed is a path separator we assume is a directory
    if (looksLikeADirectory) {
        return getCacheFileForDirectory();
    }

    return resolvedCacheFile;
}

/**
 * It will calculate the error and warning count for collection of messages per file
 * @param {Object[]} messages - Collection of messages
 * @returns {Object} Contains the stats
 * @private
 */
function calculateStatsPerFile(messages) {
    return messages.reduce(
        (stat, message) => {
            if (message.fatal || message.severity === 2) {
                stat.errorCount++;
                if (message.fix) {
                    stat.fixableErrorCount++;
                }
            } else {
                stat.warningCount++;
                if (message.fix) {
                    stat.fixableWarningCount++;
                }
            }
            return stat;
        },
        {
            errorCount: 0,
            warningCount: 0,
            fixableErrorCount: 0,
            fixableWarningCount: 0
        }
    );
}

/**
 * It will calculate the error and warning count for collection of results from all files
 * @param {Object[]} results - Collection of messages from all the files
 * @returns {Object} Contains the stats
 * @private
 */
function calculateStatsPerRun(results) {
    return results.reduce(
        (stat, result) => {
            stat.errorCount += result.errorCount;
            stat.warningCount += result.warningCount;
            stat.fixableErrorCount += result.fixableErrorCount;
            stat.fixableWarningCount += result.fixableWarningCount;
            return stat;
        },
        {
            errorCount: 0,
            warningCount: 0,
            fixableErrorCount: 0,
            fixableWarningCount: 0
        }
    );
}

/**
 * Returns result with warning by ignore settings
 * @param {string} filePath - File path of checked code
 * @param {string} baseDir  - Absolute path of base directory
 * @returns {LintResult} Result with single warning
 * @private
 */
function createIgnoreResult(filePath, baseDir) {
    let message;
    const isHidden = /^\./.test(path.basename(filePath));
    const isInNodeModules = baseDir && path.relative(baseDir, filePath).startsWith("node_modules");
    const isInBowerComponents = baseDir && path.relative(baseDir, filePath).startsWith("bower_components");

    if (isHidden) {
        message = "File ignored by default.  Use a negated ignore pattern (like \"--ignore-pattern '!<relative/path/to/filename>'\") to override.";
    } else if (isInNodeModules) {
        message = "File ignored by default. Use \"--ignore-pattern '!node_modules/*'\" to override.";
    } else if (isInBowerComponents) {
        message = "File ignored by default. Use \"--ignore-pattern '!bower_components/*'\" to override.";
    } else {
        message = "File ignored because of a matching ignore pattern. Use \"--no-ignore\" to override.";
    }

    return {
        filePath: path.resolve(filePath),
        messages: [
            {
                fatal: false,
                severity: 1,
                message
            }
        ],
        errorCount: 0,
        warningCount: 1,
        fixableErrorCount: 0,
        fixableWarningCount: 0
    };
}

/**
 * Verify
 * @param {string} text The source code to verify.
 * @param {string} filePath The path to the file of `text`.
 * @param {ConfigArray} config The config.
 * @param {boolean} fix If `true` then it does fix.
 * @param {boolean} allowInlineConfig If `true` then it uses directive comments.
 * @param {boolean} reportUnusedDisableDirectives If `true` then it reports unused `eslint-disable` comments.
 * @param {Linter} linter The linter instance to verify.
 * @returns {IterableIterator<LintMessage>} Messages.
 */
function verifyText(
    text,
    filePath,
    config,
    fix,
    allowInlineConfig,
    reportUnusedDisableDirectives,
    linter
) {
    debug(`Lint ${filePath}`);

    // Verify.
    const { fixed, messages, output } = linter.verifyAndFix(
        text,
        config,
        {
            allowInlineConfig,
            filename: filePath,
            fix,
            reportUnusedDisableDirectives
        }
    );

    // Tweak and return.
    const result = {
        filePath,
        messages,
        ...calculateStatsPerFile(messages)
    };

    if (fixed) {
        result.output = output;
    }
    if (
        result.errorCount + result.warningCount > 0 &&
        typeof result.output === "undefined"
    ) {
        result.source = text;
    }

    return result;
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * CLIEngine.
 */
class CLIEngine {

    /**
     * Returns results that only contains errors.
     * @param {LintResult[]} results The results to filter.
     * @returns {LintResult[]} The filtered results.
     */
    static getErrorResults(results) {
        const filtered = [];

        results.forEach(result => {
            const filteredMessages =
                result.messages.filter(m => m.severity === 2);

            if (filteredMessages.length > 0) {
                filtered.push(
                    Object.assign(result, {
                        messages: filteredMessages,
                        errorCount: filteredMessages.length,
                        warningCount: 0,
                        fixableErrorCount: result.fixableErrorCount,
                        fixableWarningCount: 0
                    })
                );
            }
        });

        return filtered;
    }

    /**
     * Returns the formatter representing the given format or null if no formatter
     * with the given name can be found.
     * @param {string} [format] The name of the format to load or the path to a
     *      custom formatter.
     * @returns {Function} The formatter function or null if not found.
     */
    static getFormatter(format) {
        return loadFormatter(format || "stylish", process.cwd());
    }

    /**
     * Outputs fixes from the given results to files.
     * @param {Object} report The report object created by CLIEngine.
     * @returns {void}
     */
    static outputFixes(report) {
        report.results.filter(result => Object.prototype.hasOwnProperty.call(result, "output")).forEach(result => {
            fs.writeFileSync(result.filePath, result.output);
        });
    }

    /**
     * Creates a new instance of the core CLI engine.
     * @param {CLIEngineOptions} providedOptions The options for this instance.
     */
    constructor(providedOptions) {
        const options = Object.assign(
            Object.create(null),
            DefaultOptions,
            { cwd: process.cwd() },
            providedOptions
        );

        /**
         * Stored options for this instance
         * @type {CLIEngineOptions}
         * @private
         */
        this._options = options;

        /**
         * The linter instance which has loaded rules.
         * @type {Linter}
         * @private
         */
        this._linter = new Linter();

        /**
         * The map for additional plugins.
         * @type {Map<string,Plugin>}
         * @private
         */
        this._additionalPluginPool = new Map();

        /**
         * The map for additional plugins.
         * @type {Map<string,Plugin>}
         * @private
         */
        this._ignoredPaths = new IgnoredPaths(options);

        /**
         * File enumerator.
         * @type {FileEnumerator}
         * @private
         */
        this._enumerator = new FileEnumerator({
            baseConfig: options.baseConfig || null,
            cliConfig: createConfigDataFromOptions(options),
            configArrayFactory: new ConfigArrayFactory({
                additionalPluginPool: this._additionalPluginPool
            }),
            cwd: options.cwd,
            extensions: options.extensions,
            ignore: options.ignore,
            ignoredPaths: this._ignoredPaths,
            specificConfigPath: options.configFile,
            useEslintrc: options.useEslintrc
        });

        // Load in additional rules
        for (const rulesdir of options.rulePaths || []) {
            debug(`Loading rules from ${rulesdir}`);
            this._linter.defineRules(loadRules(rulesdir, options.cwd));
        }
        if (options.rules && Object.keys(options.rules).length) {
            const loadedRules = this._linter.getRules();

            /*
             * Ajv validator with default schema will mutate original object,
             * so we must clone it recursively.
             */
            options.rules = cloneDeep(options.rules);

            for (const ruleId of Object.keys(options.rules)) {
                ConfigValidator.validateRuleOptions(
                    loadedRules.get(ruleId),
                    ruleId,
                    options.rules[ruleId],
                    "CLI"
                );
            }
        }

        // setup special filter for fixes
        if (options.fix && options.fixTypes && options.fixTypes.length > 0) {
            debug(`Using fix types ${options.fixTypes}`);

            // throw an error if any invalid fix types are found
            validateFixTypes(options.fixTypes);

            // convert to Set for faster lookup
            const fixTypes = new Set(options.fixTypes);

            // save original value of options.fix in case it's a function
            const originalFix = (typeof options.fix === "function")
                ? options.fix
                : () => options.fix;

            // create a cache of rules (but don't populate until needed)
            this._rulesCache = null;

            options.fix = lintResult => {
                const rule = this._rulesCache.get(lintResult.ruleId);
                const matches = rule.meta && fixTypes.has(rule.meta.type);

                return matches && originalFix(lintResult);
            };
        }

        // Setup cache.
        if (options.cache) {
            const cacheFile = normalizeCacheFilePath(
                options.cacheLocation || options.cacheFile,
                options.cwd
            );

            /**
             * Cache used to avoid operating on files that haven't changed since the
             * last successful execution.
             * @type {LintResultCache}
             */
            this._lintResultCache = new LintResultCache(cacheFile);
        }
    }

    /**
     * Executes the current configuration on an array of file and directory names.
     * @param {string[]} patterns An array of file and directory names.
     * @returns {Object} The results for all files that were linted.
     */
    executeOnFiles(patterns) {
        const {
            _enumerator: enumerator,
            _linter: linter,
            _options: {
                allowInlineConfig,
                cwd,
                fix,
                reportUnusedDisableDirectives
            },
            _lintResultCache
        } = this;
        const results = [];
        const startTime = Date.now();

        for (const { config, filePath, flag } of enumerator.iterateFiles(patterns)) {
            if (flag === "Ignored") {
                continue;
            }
            if (flag === "Warning") {
                results.push(createIgnoreResult(filePath, cwd));
                continue;
            }

            // Skip if there is cached result.
            if (_lintResultCache) {
                const cache = _lintResultCache.getCachedLintResults(filePath, config);
                const hadMessages = cache && cache.messages && cache.messages.length > 0;

                if (hadMessages && fix) {
                    debug(`Reprocessing cached file to allow autofix: ${filePath}`);
                } else {
                    debug(`Skipping file since it hasn't changed: ${filePath}`);
                    results.push(cache);
                    continue;
                }
            }

            /*
             * FIXME: `getRules()` returns a snapshot of loaded rules.
             * But after we support `processor` config[^1], loaded rules can be
             * changed for each virtual file name.
             *
             * [^1]: https://github.com/eslint/rfcs/pull/3
             */
            if (this._rulesCache === null) {
                this._rulesCache = this.getRules();
            }

            // Does lint.
            const result = verifyText(
                fs.readFileSync(filePath, "utf8"),
                path.relative(cwd, filePath),
                config,
                fix,
                allowInlineConfig,
                reportUnusedDisableDirectives,
                linter
            );

            results.push(result);

            // Store the result.
            if (_lintResultCache) {
                _lintResultCache.setCachedLintResults(filePath, config, result);
            }
        }

        // Persist the cache to disk.
        if (_lintResultCache) {
            _lintResultCache.reconcile();
        }

        debug(`Linting complete in: ${Date.now() - startTime}ms`);
        return {
            results,
            ...calculateStatsPerRun(results),
            usedDeprecatedRules: [] // TODO: implement
        };
    }

    /**
     * Executes the current configuration on text.
     * @param {string} text A string of JavaScript code to lint.
     * @param {string} filename An optional string representing the texts filename.
     * @param {boolean} warnIgnored Always warn when a file is ignored
     * @returns {Object} The results for the linting.
     */
    executeOnText(text, filename, warnIgnored) {
        const {
            _enumerator: enumerator,
            _ignoredPaths: ignoredPaths,
            _linter: linter,
            _options: {
                allowInlineConfig,
                cwd,
                fix,
                reportUnusedDisableDirectives
            }
        } = this;
        const results = [];
        const startTime = Date.now();
        const resolvedFilename = filename && !path.isAbsolute(filename)
            ? path.resolve(cwd, filename)
            : filename;

        if (resolvedFilename && ignoredPaths.contains(resolvedFilename)) {
            if (warnIgnored) {
                results.push(createIgnoreResult(resolvedFilename, cwd));
            }
        } else {

            /*
             * FIXME: `getRules()` returns a snapshot of loaded rules.
             * But after we support `processor` config[^1], loaded rules can be
             * changed for each virtual file name.
             *
             * [^1]: https://github.com/eslint/rfcs/pull/3
             */
            if (this._rulesCache === null) {
                this._rulesCache = this.getRules();
            }

            results.push(verifyText(
                text,
                resolvedFilename,
                enumerator.getConfigArrayForFile(
                    resolvedFilename || path.join(cwd, "unnamed.js")
                ),
                fix,
                allowInlineConfig,
                reportUnusedDisableDirectives,
                linter
            ));
        }

        debug(`Linting complete in: ${Date.now() - startTime}ms`);
        return {
            results,
            ...calculateStatsPerRun(results),
            usedDeprecatedRules: [] // TODO: implement
        };
    }

    /**
     * Get rules.
     * @returns {Map<string, Rule>} The rule map.
     */
    getRules() {
        return this._linter.getRules();
    }

    /**
     * Returns the formatter representing the given format or null if no formatter
     * with the given name can be found.
     * @param {string} [format] The name of the format to load or the path to a
     *      custom formatter.
     * @returns {Function} The formatter function or null if not found.
     */
    getFormatter(format) {
        return loadFormatter(format || "stylish", this._options.cwd);
    }

    /**
     * Returns a configuration object for the given file based on the CLI options.
     * This is the same logic used by the ESLint CLI executable to determine
     * configuration for each file it processes.
     * @param {string} filePath The path of the file to retrieve a config object for.
     * @returns {Object} A configuration object for the file.
     */
    getConfigForFile(filePath) {
        const absolutePath = path.resolve(this._options.cwd, filePath);
        const relativePath = path.relative(this._options.cwd, absolutePath);

        return this._enumerator.getConfigArrayForFile(absolutePath)
            .extractConfig(relativePath);
    }

    /**
     * Checks if a given path is ignored by ESLint.
     * @param {string} filePath The path of the file to check.
     * @returns {boolean} Whether or not the given path is ignored.
     */
    isPathIgnored(filePath) {
        return this._ignoredPaths.contains(filePath);
    }

    /**
     * Add a plugin by passing its configuration
     * @param {string} name Name of the plugin.
     * @param {Object} pluginObject Plugin configuration object.
     * @returns {void}
     */
    addPlugin(name, pluginObject) {
        this._additionalPluginPool.set(name, pluginObject);
    }

    /**
     * Resolves the patterns passed into executeOnFiles() into glob-based patterns
     * for easier handling.
     * @param {string[]} patterns The file patterns passed on the command line.
     * @returns {string[]} The equivalent glob patterns.
     */
    resolveFileGlobPatterns(patterns) { // eslint-disable-line class-methods-use-this
        // TODO: we don't use this logic anymore, but implement it.
        return patterns;
    }
}

module.exports = CLIEngine;
