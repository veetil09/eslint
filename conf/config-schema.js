/**
 * @fileoverview Defines a schema for configs.
 * @author Sylvan Mably
 */

"use strict";

const baseConfigProperties = {
    env: { type: "object" },
    extends: { $ref: "#/definitions/stringOrStrings" },
    globals: { type: "object" },
    overrides: {
        type: "array",
        items: { $ref: "#/definitions/overrideConfig" },
        additionalItems: false
    },
    parser: { type: ["string", "null"] },
    parserOptions: { type: "object" },
    plugins: { type: "array" },
    rules: { type: "object" },
    settings: { type: "object" }
};

const configSchema = {
    definitions: {
        stringOrStrings: {
            anyOf: [
                { type: "string" },
                {
                    type: "array",
                    items: { type: "string" },
                    uniqueItems: true
                }
            ]
        },
        stringOrStringsRequired: {
            anyOf: [
                { type: "string" },
                {
                    type: "array",
                    items: { type: "string" },
                    minItems: 1,
                    uniqueItems: true
                }
            ]
        },

        // Config at top-level.
        topLevelConfig: {
            type: "object",
            properties: Object.assign(
                {
                    ecmaFeatures: { type: "object" }, // deprecated; logs a warning when used
                    root: { type: "boolean" }
                },
                baseConfigProperties
            ),
            additionalProperties: false
        },

        // Config in `overrides`.
        overrideConfig: {
            type: "object",
            properties: Object.assign(
                {
                    excludedFiles: { $ref: "#/definitions/stringOrStrings" },
                    files: { $ref: "#/definitions/stringOrStringsRequired" }
                },
                baseConfigProperties,
            ),
            required: ["files"],
            additionalProperties: false
        }
    },

    $ref: "#/definitions/topLevelConfig"
};

module.exports = configSchema;
