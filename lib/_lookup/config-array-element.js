"use strict";

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

// eslint-disable-next-line valid-jsdoc
/**
 * Convert a loaded definition to that file path.
 * @param {{filePath?:string, id:string, importerPath:string}} obj The object to convert to a string.
 * @returns {string} The file path.
 */
function toFilePath(obj) {
    return obj.filePath ? obj.filePath : `${obj.id} from ${obj.importerPath}`;
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

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

module.exports = ConfigArrayElement;
