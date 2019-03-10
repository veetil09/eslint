"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const ExtractedConfig = require("./extracted-config");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Check if a value is a non-null object.
 * @param {any} x The value to check.
 * @returns {boolean} `true` if the value is a non-null object.
 */
function isNonNullObject(x) {
    return typeof x === "object" && x !== null;
}

/**
 * Merge two objects.
 *
 * Assign every property values of `y` to `x` if `x` doesn't have the property.
 * If `x`'s property value is an object, it does recursive.
 * If either property value is an array, it concatenates those.
 *
 * @param {Object} target The destination to merge
 * @param {Object|undefined} source The source to merge.
 * @returns {void}
 */
function assignWithoutOverwrite(target, source) {
    if (!isNonNullObject(source)) {
        return;
    }

    for (const key of Object.keys(source)) {
        if (isNonNullObject(target[key])) {
            assignWithoutOverwrite(target[key], source[key]);
        } else if (target[key] === void 0) {
            if (isNonNullObject(source[key])) {
                target[key] = Array.isArray(source[key]) ? [] : {};
                assignWithoutOverwrite(target[key], source[key]);
            } else if (source[key] !== void 0) {
                target[key] = source[key];
            }
        }
    }
}

/**
 * Merge plugins.
 * `target`'s definition is prior to `source`'s.
 *
 * TODO: solve https://gist.github.com/not-an-aardvark/169bede8072c31a500e018ed7d6a8915
 *
 * @param {Object} target The destination to merge
 * @param {Object|undefined} source The source to merge.
 * @returns {void}
 */
function mergePlugins(target, source) {
    if (!isNonNullObject(source)) {
        return;
    }

    for (const key of Object.keys(source)) {
        const targetValue = target[key];
        const sourceValue = source[key];

        if (targetValue === void 0) {
            if (sourceValue.error) {
                throw sourceValue.error;
            }
            target[key] = sourceValue;
        } else if (targetValue.definition !== sourceValue.definition) {
            if (sourceValue.error) {
                throw sourceValue.error;
            }

            const error = new Error(`Plugin "${key}" was conflicted.`);

            error.messageTemplate = "plugin-conflict";
            error.messageData = {
                pluginName: key,
                plugin1: sourceValue,
                plugin2: targetValue
            };

            throw error;
        }
    }
}

/**
 * Merge rules.
 * `target`'s definition is prior to `source`'s.
 *
 * @param {Object} target The destination to merge
 * @param {Object|undefined} source The source to merge.
 * @returns {void}
 */
function mergeRules(target, source) {
    if (!isNonNullObject(source)) {
        return;
    }

    for (const key of Object.keys(source)) {
        const targetDef = target[key];
        const sourceDef = source[key];

        if (targetDef === void 0) {
            if (Array.isArray(sourceDef)) {
                target[key] = [...sourceDef];
            } else {
                target[key] = [sourceDef]; // Severity only.
            }
        } else if (
            targetDef.length === 1 &&
            Array.isArray(sourceDef) &&
            sourceDef.length >= 2
        ) {
            targetDef.push(...sourceDef.slice(1)); // Options only.
        }
    }
}

/**
 * Resolve `config.processor`.
 * @param {ExtractedConfigData} config The extracted config.
 * @returns {void}
 */
function resolveProcessor(config) {
    if (!config.processor) {
        return;
    }

    const pos = config.processor.indexOf("/");

    if (pos !== -1) {
        const pluginName = config.processor.slice(0, pos);
        const processorName = config.processor.slice(pos + 1);
        const plugin = config.plugins[pluginName];
        const processor =
            plugin &&
            plugin.definition.processors &&
            plugin.definition.processors[processorName];

        if (processor) {
            config.processor = {
                definition: processor,
                id: config.processor
            };
        } else {
            throw new Error(`Processor '${config.processor}' not found.`);
        }
    } else {
        throw new Error(`Invalid processor name: '${config.processor}'`);
    }
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * The Config Array.
 *
 * `ConfigArray` instance contains all settings, parsers, and plugins.
 * You need to call `ConfigArray#extractConfig(filePath)` method in order to
 * extract, merge and get only the config data which is related to an arbitrary
 * file.
 */
class ConfigArray extends Array {

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
     *
     * This is used to lint files other than `.js` automatically.
     *
     * @param {string} relativePath The relative path to a file to check.
     * @returns {boolean} `true` if matched or there are no entries which have
     * `files` property.
     */
    matchFile(relativePath) {
        return this.some(element =>
            element.matchFile &&
            !element.matchFile.widely &&
            element.matchFile(relativePath));
    }

    /**
     * Iterate all parsers which are succeeded to load.
     * @returns {IterableIterator<[string, {definition:Parser, filePath:string, id:string, importerPath:string}]>} Parsers.
     */
    *getAllParsers() {
        for (const { parser } of this) {
            if (!parser || !parser.definition) {
                continue;
            }

            yield [parser.id, parser];
        }
    }

    /**
     * Iterate all plugins which are succeeded to load.
     * @returns {IterableIterator<[string, {definition:Plugin, filePath:string, id:string, importerPath:string}]>} Plugins.
     */
    *getAllPlugins() {
        for (const { plugins } of this) {
            if (!plugins) {
                continue;
            }

            for (const [id, plugin] of Object.entries(plugins)) {
                if (!plugin.definition) {
                    continue;
                }

                yield [id, plugin];
            }
        }
    }

    /**
     * Extract the config data which is related to a given file.
     * @param {string} targetFilePath The relative path to the target file.
     * @returns {ExtractedConfigData} The extracted config data.
     */
    extractConfig(targetFilePath) {
        const config = new ExtractedConfig();

        for (let i = this.length - 1; i >= 0; --i) {
            const element = this[i];

            // Check `files`/`excludedFiles` property.
            if (element.matchFile && !element.matchFile(targetFilePath)) {
                continue;
            }

            // Merge.
            if (!config.parser && element.parser) {
                if (element.parser.error) {
                    throw element.parser.error;
                }
                config.parser = element.parser;
            }
            if (!config.processor && element.processor) {
                config.processor = element.processor;
            }
            assignWithoutOverwrite(config.env, element.env);
            assignWithoutOverwrite(config.globals, element.globals);
            assignWithoutOverwrite(config.parserOptions, element.parserOptions);
            assignWithoutOverwrite(config.settings, element.settings);
            mergePlugins(config.plugins, element.plugins);
            mergeRules(config.rules, element.rules);
        }
        resolveProcessor(config);

        return config;
    }
}

module.exports = ConfigArray;
