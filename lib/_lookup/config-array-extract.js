/**
 * @fileoverview Merge a config array to one object.
 */
"use strict";

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
        } else if (
            targetValue.importerPath !== sourceValue.importerPath &&
            targetValue.importerPath !== targetValue.filePath &&
            sourceValue.importerPath !== sourceValue.filePath
        ) {

            // https://gist.github.com/not-an-aardvark/169bede8072c31a500e018ed7d6a8915
            throw new Error(
                `Duplicated loading a plugin: ${
                    key
                }\n  Importer[0]: ${
                    targetValue.importerPath
                }\n  Importer[1]: ${
                    sourceValue.importerPath
                }`
            );
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

/**
 * The class for extracted config data.
 *
 * This class provides `toJSON` method for debuggable.
 */
class ExtractedConfigData {
    constructor() {

        /**
         * Environments.
         * @type {Record<string, boolean>}
         */
        this.env = {};

        /**
         * Global variables.
         * @type {Record<string, boolean|"readonly"|"readable"|"writable"|"writeable"|"off">}
         */
        this.globals = {};

        /**
         * Parser definition.
         * @type {null|{ definition:Object, filePath:string, id:string, importerPath:string }}
         */
        this.parser = null;

        /**
         * Options for the parser.
         * @type {Object}
         */
        this.parserOptions = {};

        /**
         * Plugin definitions.
         * @type {Record<string, { definition:Object, filePath:string, id:string, importerPath:string }>}
         */
        this.plugins = {};

        /**
         * Processor definition.
         * @type {null|{ definition:Object, id:string }}
         */
        this.processor = null;

        /**
         * Rule settings.
         * @type {Record<string, Array>}
         */
        this.rules = {};

        /**
         * Shared settings.
         * @type {Object}
         */
        this.settings = {};
    }

    /**
     * @returns {Object} a JSON compatible object.
     */
    toJSON() {
        return {
            ...this,
            parser: this.parser && this.parser.filePath || this.parser,
            plugins: Object.values(this.plugins).map(p => p.filePath),
            processor: this.processor && this.processor.id
        };
    }

    [Symbol.for("nodejs.util.inspect.custom")]() {
        return this.toJSON();
    }
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * Extract the config data which is related to a given file.
 * @param {ConfigEntry[]} entries The config entries to merge.
 * @param {string} targetFilePath The relative path to the target file.
 * @returns {ExtractedConfigData} The extracted config data.
 */
function extractConfig(entries, targetFilePath) {
    const config = new ExtractedConfigData();

    for (let i = entries.length - 1; i >= 0; --i) {
        const entry = entries[i];

        // Check `files`/`excludedFiles` property.
        if (entry.matchFile && !entry.matchFile(targetFilePath)) {
            continue;
        }

        // Merge.
        if (!config.parser && entry.parser) {
            if (entry.parser.error) {
                throw entry.parser.error;
            }
            config.parser = entry.parser;
        }
        if (!config.processor && entry.processor) {
            config.processor = entry.processor;
        }
        assignWithoutOverwrite(config.env, entry.env);
        assignWithoutOverwrite(config.globals, entry.globals);
        assignWithoutOverwrite(config.parserOptions, entry.parserOptions);
        assignWithoutOverwrite(config.settings, entry.settings);
        mergePlugins(config.plugins, entry.plugins);
        mergeRules(config.rules, entry.rules);
    }
    resolveProcessor(config);

    return config;
}

module.exports = { extractConfig };
