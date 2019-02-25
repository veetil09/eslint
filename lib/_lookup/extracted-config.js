"use strict";

/**
 * The class for extracted config data.
 *
 * This class provides `toJSON` method for debuggable.
 */
class ExtractedConfig {
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

module.exports = ExtractedConfig;
