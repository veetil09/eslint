/**
 * @fileoverview Find formatter.
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const path = require("path");
const ModuleResolver = require("./module-resolver");
const { getNamespaceFromTerm, normalizePackageName } = require("./naming");

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * Returns the formatter representing the given format or null if no formatter
 * with the given name can be found.
 * @param {string} format The name of the format to load or the path to a
 *      custom formatter.
 * @param {string} cwd The path to the base directory.
 * @returns {Function} The formatter function or null if not found.
 */
function loadFormatter(format, cwd) {
    if (typeof format !== "string") {
        return null;
    }

    // replace \ with / for Windows compatibility
    const normalizedFormatName = format.replace(/\\/g, "/");
    const namespace = getNamespaceFromTerm(normalizedFormatName);
    let formatterPath;

    // if there's a slash, then it's a file
    if (!namespace && normalizedFormatName.indexOf("/") > -1) {
        formatterPath = path.resolve(cwd, normalizedFormatName);
    } else {
        try {
            const npmFormat =
                normalizePackageName(normalizedFormatName, "eslint-formatter");

            formatterPath = ModuleResolver.resolve(
                npmFormat,
                path.join(cwd, "node_modules")
            );
        } catch (e) {
            formatterPath = `../formatters/${normalizedFormatName}`;
        }
    }

    try {
        return require(formatterPath);
    } catch (ex) {
        ex.message = `There was a problem loading formatter: ${formatterPath}\nError: ${ex.message}`;
        throw ex;
    }
}

module.exports = loadFormatter;
