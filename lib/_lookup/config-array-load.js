/**
 * @fileoverview Load the config file on a given directory if exists.
 *
 * - This logic resolves `extends` property.
 * - This logic flattens `extends` and `overrides` to one array.
 * - Each config entry, this logic resolves `parser` and `plugins`.
 *
 * For example:
 *
 * ```json
 * {
 *     "extends": [
 *         "eslint:recommended",
 *         "plugin:foo/recommended"
 *     ],
 *     "rules": { ... },
 *     "overrides": [
 *         { "files": "*.js", "rules": { ... } },
 *         { "files": "*.ts", "rules": { ... } }
 *     ]
 * }
 * ```
 *
 * is flattened to:
 *
 * ```json
 * [
 *     // extends:
 *     "eslint:recommended",
 *     "plugin:foo/recommended"
 *
 *     // the config body except `extends` and `overrides`:
 *     { "rules": { ... } },
 *
 *     // overrides:
 *     { "files": "*.js", "rules": { ... } },
 *     { "files": "*.ts", "rules": { ... } }
 * ]
 * ```
 *
 * and the `extends` strings are resolved:
 *
 * ```jsonc
 * [
 *     {
 *         "name": "eslint:recommended",
 *         "filePath": "...",
 *         "rules": { ... }
 *     },
 *
 *     // if the `extends` setting has `extends` / `overrides` arrays, flatten it recursively:
 *     {
 *         "name": "plugin:foo/recommended",
 *         "filePath": "node_modules/eslint-plugin-foo/index.js",
 *         "rules": { ... }
 *     },
 *     {
 *         "name": "plugin:foo/recommended#overrides[0]",
 *         "filePath": "node_modules/eslint-plugin-foo/index.js",
 *         "matchFile": Function, // matches to "*.test.js"
 *         "rules": { ... }
 *     },
 *
 *     // the config body except `extends` and `overrides`:
 *     {
 *         "name": ".eslintrc.json",
 *         "filePath": ".eslintrc.json",
 *         "rules": { ... }
 *     },
 *
 *     // overrides:
 *     {
 *         "name": ".eslintrc.json",
 *         "filePath": ".eslintrc.json",
 *         "matchFile": Function, // matches to "*.js"
 *         "rules": { ... }
 *     },
 *     {
 *         "name": ".eslintrc.json",
 *         "filePath": ".eslintrc.json",
 *         "matchFile": Function, // matches to "*.ts"
 *         "rules": { ... }
 *     }
 * ]
 * ```
 *
 * For example about `parser` and `plugins`:
 *
 * ```jsonc
 * [
 *     {
 *         "parser": "awesome-parser",
 *         "plugins": ["foo", "bar"],
 *         "rules": { ... }
 *     }
 * ]
 * ```
 *
 * is resolved as:
 *
 * ```jsonc
 * [
 *     {
 *         "parser": {
 *             "id": "awesome-parser",
 *             "parseForESLint": Function
 *         },
 *         "plugins": {
 *             "foo": {
 *                 "configs": { ... },
 *                 "environments": { ... },
 *                 "rules": { ... }
 *             },
 *             "bar": {
 *                 "configs": { ... },
 *                 "environments": { ... },
 *                 "rules": { ... }
 *             }
 *         },
 *         "rules": { ... }
 *     }
 * ]
 * ```
 *
 * Therefore, we don't need any filesystem on time to use it.
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const importFresh = require("import-fresh");
const { Minimatch } = require("minimatch");
const stripComments = require("strip-json-comments");
const { validateConfigSchema } = require("../config/config-validator");
const ModuleResolver = require("./module-resolver");
const naming = require("./naming");
const debug = require("debug")("eslint:config-array");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const eslintRecommendedPath = path.resolve(__dirname, "../../conf/eslint-recommended.js");
const eslintAllPath = path.resolve(__dirname, "../../conf/eslint-all.js");
const configFilenames = [
    ".eslintrc.js",
    ".eslintrc.yaml",
    ".eslintrc.yml",
    ".eslintrc.json",
    ".eslintrc",
    "package.json"
];
const minimatchOpts = { dot: true, matchBase: true };

/**
 * Normalize a given pattern to an array.
 * @param {string|string[]|undefined} patterns A glob pattern or an array of glob patterns.
 * @returns {string[]|null} Normalized patterns.
 * @private
 */
function normalizePatterns(patterns) {
    if (Array.isArray(patterns) && patterns.length >= 1) {
        return patterns;
    }
    if (typeof patterns === "string") {
        return [patterns];
    }
    return null;
}

// eslint-disable-next-line valid-jsdoc
/**
 * Define `match` method to check if a relative path should be linted or not.
 * @param {string|string[]|undefined} files The glob patterns to include files.
 * @param {string|string[]|undefined} excludedFiles The glob patterns to exclude files.
 * @returns {((relativePath: string) => boolean)|null} The `match` method to check if a relative path should be linted or not.
 * @private
 */
function defineMatch(files, excludedFiles) {
    const includes = normalizePatterns(files);
    const excludes = normalizePatterns(excludedFiles);
    const positiveMatchers = includes && includes.map(pattern => new Minimatch(pattern, minimatchOpts));
    const negativeMatchers = excludes && excludes.map(pattern => new Minimatch(pattern, minimatchOpts));
    let retv;

    if (positiveMatchers && negativeMatchers) {
        retv = relativePath =>
            positiveMatchers.some(m => m.match(relativePath)) &&
            negativeMatchers.every(m => !m.match(relativePath));
    } else if (positiveMatchers) {
        retv = relativePath =>
            positiveMatchers.some(m => m.match(relativePath));
    } else if (negativeMatchers) {
        retv = relativePath =>
            negativeMatchers.every(m => !m.match(relativePath));
    }

    if (retv) {
        Object.defineProperty(retv, "name", {
            configurable: true,
            value: JSON.stringify({ includes, excludes })
        });
    }
    return retv;
}

// eslint-disable-next-line valid-jsdoc
/**
 * Combine two functions by logical and.
 * @param {(relativePath: string) => boolean} f A function to combine.
 * @param {(relativePath: string) => boolean} g Another function to combine.
 * @returns {(relativePath: string) => boolean} The combined function.
 * @private
 */
function defineAnd(f, g) {
    return Object.assign(
        relativePath => f(relativePath) && g(relativePath),
        { name: JSON.stringify({ and: [f, g] }) }
    );
}

// eslint-disable-next-line valid-jsdoc
/**
 * Make `matchFile` property with a given `matchFile` function for every config entry.
 * @param {IterableIterator<ConfigArrayElement>} normalizedConfig The normalized config data.
 * @param {(relativePath: string) => boolean} matchFile The function to check if a relative path should be linted or not.
 * @returns {IterableIterator<ConfigArrayElement>} The normalized config with `matchFile`.
 * @private
 */
function *combineMatchFile(normalizedConfig, matchFile) {
    if (matchFile) {
        for (const configData of normalizedConfig) {
            if (configData.matchFile) {
                configData.matchFile =
                    defineAnd(normalizedConfig.matchFile, matchFile);
            } else {
                configData.matchFile = matchFile;
            }
            yield configData;
        }
    } else {
        yield* normalizedConfig;
    }
}

/**
 * Convenience wrapper for synchronously reading file contents.
 * @param {string} filePath The filename to read.
 * @returns {string} The file contents, with the BOM removed.
 * @private
 */
function readFile(filePath) {
    return fs.readFileSync(filePath, "utf8").replace(/^\ufeff/, "");
}

/**
 * Loads a YAML configuration from a file.
 * @param {string} filePath The filename to load.
 * @returns {ConfigData} The configuration object from the file.
 * @throws {Error} If the file cannot be read.
 * @private
 */
function loadYAMLConfigFile(filePath) {
    debug(`Loading YAML config file: ${filePath}`);

    // lazy load YAML to improve performance when not used
    const yaml = require("js-yaml");

    try {

        // empty YAML file can be null, so always use
        return yaml.safeLoad(readFile(filePath)) || {};
    } catch (e) {
        debug(`Error reading YAML file: ${filePath}`);
        e.message = `Cannot read config file: ${filePath}\nError: ${e.message}`;
        throw e;
    }
}

/**
 * Loads a JSON configuration from a file.
 * @param {string} filePath The filename to load.
 * @returns {ConfigData} The configuration object from the file.
 * @throws {Error} If the file cannot be read.
 * @private
 */
function loadJSONConfigFile(filePath) {
    debug(`Loading JSON config file: ${filePath}`);

    try {
        return JSON.parse(stripComments(readFile(filePath)));
    } catch (e) {
        debug(`Error reading JSON file: ${filePath}`);
        e.message = `Cannot read config file: ${filePath}\nError: ${e.message}`;
        e.messageTemplate = "failed-to-read-json";
        e.messageData = {
            path: filePath,
            message: e.message
        };
        throw e;
    }
}

/**
 * Loads a legacy (.eslintrc) configuration from a file.
 * @param {string} filePath The filename to load.
 * @returns {ConfigData} The configuration object from the file.
 * @throws {Error} If the file cannot be read.
 * @private
 */
function loadLegacyConfigFile(filePath) {
    debug(`Loading config file: ${filePath}`);

    // lazy load YAML to improve performance when not used
    const yaml = require("js-yaml");

    try {
        return yaml.safeLoad(stripComments(readFile(filePath))) || /* istanbul ignore next */ {};
    } catch (e) {
        debug(`Error reading YAML file: ${filePath}`);
        e.message = `Cannot read config file: ${filePath}\nError: ${e.message}`;
        throw e;
    }
}

/**
 * Loads a JavaScript configuration from a file.
 * @param {string} filePath The filename to load.
 * @returns {ConfigData} The configuration object from the file.
 * @throws {Error} If the file cannot be read.
 * @private
 */
function loadJSConfigFile(filePath) {
    debug(`Loading JS config file: ${filePath}`);
    try {
        return importFresh(filePath);
    } catch (e) {
        debug(`Error reading JavaScript file: ${filePath}`);
        e.message = `Cannot read config file: ${filePath}\nError: ${e.message}`;
        throw e;
    }
}

/**
 * Loads a configuration from a package.json file.
 * @param {string} filePath The filename to load.
 * @returns {ConfigData} The configuration object from the file.
 * @throws {Error} If the file cannot be read.
 * @private
 */
function loadPackageJSONConfigFile(filePath) {
    debug(`Loading package.json config file: ${filePath}`);
    try {
        return loadJSONConfigFile(filePath).eslintConfig || null;
    } catch (e) {
        debug(`Error reading package.json file: ${filePath}`);
        e.message = `Cannot read config file: ${filePath}\nError: ${e.message}`;
        throw e;
    }
}

/**
 * Creates an error to notify about a missing config to extend from.
 * @param {string} configName The name of the missing config.
 * @returns {Error} The error object to throw
 * @private
 */
function configMissingError(configName) {
    const error = new Error(`Failed to load config "${configName}" to extend from.`);

    error.messageTemplate = "extend-config-missing";
    error.messageData = {
        configName
    };
    return error;
}

/**
 * Loads a configuration file regardless of the source. Inspects the file path
 * to determine the correctly way to load the config file.
 * @param {string} filePath The path to the configuration.
 * @returns {ConfigData|null} The configuration information.
 * @private
 */
function loadConfigFile(filePath) {
    let config;

    switch (path.extname(filePath)) {
        case ".js":
            config = loadJSConfigFile(filePath);
            break;

        case ".json":
            if (path.basename(filePath) === "package.json") {
                config = loadPackageJSONConfigFile(filePath);
            } else {
                config = loadJSONConfigFile(filePath);
            }
            break;

        case ".yaml":
        case ".yml":
            config = loadYAMLConfigFile(filePath);
            break;

        default:
            config = loadLegacyConfigFile(filePath);
    }

    if (config) {
        validateConfigSchema(config, filePath);
    }

    return config;
}

/**
 * Load a given parser.
 * @param {string} nameOrPath The package name or the path to a parser file.
 * @param {string} importerPath The path to a config file that imports it.
 * @returns {{definition:Object, filePath:string, id:string, importerPath:string}|{error:Error, id:string, importerPath:string}} The loaded parser.
 */
function loadParser(nameOrPath, importerPath) {
    debug(`Loading parser: ${nameOrPath} from ${importerPath}`);

    try {
        const filePath = ModuleResolver.resolve(nameOrPath, importerPath);

        return {
            definition: require(filePath),
            filePath,
            id: nameOrPath,
            importerPath
        };
    } catch (error) {
        return {
            error: error instanceof Error ? error : new Error(error),
            id: nameOrPath,
            importerPath
        };
    }
}

/**
 * Load a given plugin.
 * @param {string} name The plugin name to load.
 * @param {string} importerPath The path to a config file that imports it.
 * @returns {{definition:Object, filePath:string, id:string, importerPath:string}|{error:Error, id:string, importerPath:string}} The loaded plugin.
 */
function loadPlugin(name, importerPath) {
    debug(`Loading plugin: ${name} from ${importerPath}`);

    const longName = naming.normalizePackageName(name, "eslint-plugin");
    const id = naming.getShorthandName(longName, "eslint-plugin");

    if (name.match(/\s+/)) {
        const error = new Error(`Whitespace found in plugin name '${name}'`);

        error.messageTemplate = "whitespace-found";
        error.messageData = { pluginName: longName };

        return { error, id, importerPath };
    }

    try {
        const filePath = ModuleResolver.resolve(longName, importerPath);

        return {
            definition: require(filePath),
            filePath,
            id,
            importerPath
        };
    } catch (error) {
        if (error && error.code === "MODULE_NOT_FOUND") {
            debug(`Failed to load plugin ${longName}.`);
            error.message = `Failed to load plugin ${longName}: ${error.message}`;
            error.messageTemplate = "plugin-missing";
            error.messageData = {
                pluginName: longName,
                eslintPath: path.resolve(__dirname, "../..")
            };
        }

        return {
            error: error instanceof Error ? error : new Error(error),
            id,
            importerPath
        };
    }
}

/**
 * Load given plugins.
 * @param {string[]} names The plugin names to load.
 * @param {string} importerPath The path to a config file that imports it.
 * @returns {Object} The loaded parser.
 */
function loadPlugins(names, importerPath) {
    return names.reduce((map, name) => {
        const plugin = loadPlugin(name, importerPath);

        map[plugin.id] = plugin;

        return map;
    }, {});
}

/**
 * Load configs of an element in `extends`.
 * @param {string} name The name of a base config.
 * @param {string} filePath The file path which has the `extends` property.
 * @returns {IterableIterator<ConfigArrayElement>} The normalized config.
 * @private
 */
function *loadExtends(name, filePath) {
    debug(`Loading 'extends' of a config file: ${name} from ${filePath}`);

    // Core config
    if (name.startsWith("eslint:")) {
        if (name === "eslint:recommended") {
            yield* loadConfigData(eslintRecommendedPath, { name }); // eslint-disable-line no-use-before-define
        } else if (name === "eslint:all") {
            yield* loadConfigData(eslintAllPath, { name }); // eslint-disable-line no-use-before-define
        } else {
            throw configMissingError(name);
        }

    // Plugin's config
    } else if (name.startsWith("plugin:")) {
        const pluginName = name.slice(7, name.lastIndexOf("/"));
        const configName = name.slice(name.lastIndexOf("/") + 1);
        const plugin = loadPlugin(pluginName, filePath);
        const pluginConfigData =
            plugin.definition &&
            plugin.definition.configs &&
            plugin.definition.configs[configName];

        if (pluginConfigData) {
            validateConfigSchema(pluginConfigData, name);
            yield* normalizeConfigData( // eslint-disable-line no-use-before-define
                pluginConfigData,
                { filePath: plugin.filePath, name }
            );
        } else {
            throw configMissingError(name);
        }

    // Shareable config
    } else if (/^(?:\w|@)(?!:)/.test(name)) {
        const normalizedConfigName =
            naming.normalizePackageName(name, "eslint-config");
        const configFilePath =
            ModuleResolver.resolve(normalizedConfigName, filePath);

        yield* loadConfigData(configFilePath, { name }); // eslint-disable-line no-use-before-define

    // Absolute path to a config.
    } else if (path.isAbsolute(name)) {
        yield* loadConfigData(name); // eslint-disable-line no-use-before-define

    // Relative path to a config.
    } else {
        yield* loadConfigData(path.resolve(path.dirname(filePath), name)); // eslint-disable-line no-use-before-define
    }
}

// eslint-disable-next-line valid-jsdoc
/**
 * Convert a loaded definition to that file path.
 * @param {{filePath?:string, id:string, importerPath:string}} obj The object to convert to a string.
 * @returns {string} The file path.
 */
function toFilePath(obj) {
    return obj.filePath ? obj.filePath : `${obj.id} from ${obj.importerPath}`;
}

/**
 * The class for each element of config array.
 *
 * This class provides `toJSON` method for debuggable.
 */
class ConfigArrayElement {
    constructor(

        // From config files.
        {
            env,
            globals,
            parser,
            parserOptions,
            plugins,
            processor,
            root,
            rules,
            settings
        },

        // Additional data
        {
            filePath = "",
            name = "",
            matchFile
        }
    ) {

        /**
         * The name of this config.
         * @type {string}
         */
        this.name = name;

        /**
         * The path to the file which defined this config.
         * @type {string}
         */
        this.filePath = filePath;

        /**
         * The predicate function to check if this config should apply to a given file.
         * This is made from `files` and `excludedFiles` properties.
         * `matchFile.name` must include the value of those properties.
         * @type {((relativePath:string) => boolean)|null}
         */
        this.matchFile = matchFile;

        /**
         * Environments.
         * @type {Record<string, boolean>|undefined}
         */
        this.env = env;

        /**
         * Global variables.
         * @type {Record<string, boolean|"readonly"|"readable"|"writable"|"writeable"|"off">|undefined}
         */
        this.globals = globals;

        /**
         * Parser definition.
         * @type {{definition:Object, filePath:string, id:string, importerPath:string}|{error:Error, id:string, importerPath:string}|undefined}
         */
        this.parser = parser;

        /**
         * Options for the parser.
         * @type {Object|undefined}
         */
        this.parserOptions = parserOptions;

        /**
         * Plugin definitions.
         * @type {Record<string, {definition:Object, filePath:string, id:string, importerPath:string}|{error:Error, id:string, importerPath:string}>|undefined}
         */
        this.plugins = plugins;

        /**
         * Processor definition.
         * @type {string|undefined}
         */
        this.processor = processor;

        /**
         * The flag to ignore configs in the ancestor directories.
         * @type {boolean|undefined}
         */
        this.root = root && !matchFile;

        /**
         * Rule settings.
         * @type {Record<string, Array>|undefined}
         */
        this.rules = rules;

        /**
         * Shared settings.
         * @type {Object|undefined}
         */
        this.settings = settings;
    }

    /**
     * @returns {Object} a JSON compatible object.
     */
    toJSON() {
        return {
            ...this,
            matchFile: this.matchFile && JSON.parse(this.matchFile.name),
            parser: this.parser && toFilePath(this.parser),
            plugins: this.plugins && Object.values(this.plugins).map(toFilePath)
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
 * Normalize a given config to an array.
 * @param {ConfigData} configData The config data to normalize.
 * @param {Object} [options] The file path.
 * @param {string} [options.filePath] The file path of this config.
 * @param {string} [options.name] The name of this config.
 * @returns {IterableIterator<ConfigArrayElement>} The normalized config.
 */
function *normalizeConfigData(
    configData,
    { filePath = "", name = path.basename(filePath) } = {}
) {
    const {
        files,
        excludedFiles,
        extends: extend,
        overrides: overrideList = [],
        parser,
        plugins: pluginList,
        ...configBody
    } = configData;
    const matchFile = defineMatch(files, excludedFiles);
    const extendList = Array.isArray(extend) ? extend : [extend].filter(Boolean);

    // Expand `extends`.
    for (const extendName of extendList) {
        yield* combineMatchFile(loadExtends(extendName, filePath), matchFile);
    }

    // Load parser & plugins.
    if (parser) {
        configBody.parser = loadParser(parser, filePath);
    }
    if (pluginList) {
        configBody.plugins = loadPlugins(pluginList, filePath);
    }

    // Take extension processors.
    for (const [pluginId, { definition: plugin }] of
        Object.entries(configBody.plugins || {})
    ) {
        for (const processorId of
            Object.keys((plugin && plugin.processors) || {})
        ) {
            if (processorId.startsWith(".")) {
                yield normalizeConfigData(
                    {
                        files: [`*\\${processorId}`],
                        processor: `${pluginId}/${processorId}`
                    },
                    {
                        filePath,
                        name: `${name}#processors[${processorId}]`
                    }
                );
            }
        }
    }

    // Locate the body between `extends` and `overrides`.
    yield new ConfigArrayElement(configBody, { name, filePath, matchFile });

    // Expand `overries`.
    for (let i = 0; i < overrideList.length; ++i) {
        yield* combineMatchFile(
            normalizeConfigData(
                overrideList[i],
                { filePath, name: `${name}#overrides[${i}]` }
            ),
            matchFile
        );
    }
}

/**
 * Load a given config file.
 * @param {string} filePath The path to a config file.
 * @param {Object} [options] The options.
 * @param {string} [options.name] The config name.
 * @returns {IterableIterator<ConfigArrayElement>} Loaded config.
 */
function loadConfigData(filePath, { name } = {}) {
    debug(`Loading a config data: ${filePath}`);

    const configData = loadConfigFile(filePath);

    if (!configData) {
        throw new Error(`Config data not found: ${name || filePath}`);
    }
    return normalizeConfigData(configData, { filePath, name });
}

/**
 * Load the config file on a given directory if exists.
 * @param {string} directoryPath The path to a directory.
 * @param {Object} [options] The options.
 * @param {string} [options.name] The config name.
 * @returns {IterableIterator<ConfigArrayElement> | null} Loaded config. `null` if any config doesn't exist.
 */
function loadConfigDataOnDirectory(directoryPath, { name } = {}) {
    for (const filename of configFilenames) {
        const filePath = path.join(directoryPath, filename);

        try {
            const originalEnabled = debug.enabled;
            let configData;

            debug.enabled = false;
            try {
                configData = loadConfigFile(filePath);
            } finally {
                debug.enabled = originalEnabled;
            }

            if (configData) {
                debug(`Config file found: ${filePath}`);
                return normalizeConfigData(configData, { filePath, name });
            }
        } catch (error) {
            if (error.code !== "ENOENT" && error.code !== "MODULE_NOT_FOUND") {
                throw error;
            }
        }
    }

    debug("Config file not found.");
    return null;
}

module.exports = {
    loadConfigData,
    loadConfigDataOnDirectory,
    normalizeConfigData
};
