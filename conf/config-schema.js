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
    plugins: {
        anyOf: [
            {
                type: "array",
                items: { type: "string" },
                additionalItems: false
            },
            {
                type: "object",
                additionalProperties: { type: "string" }
            }
        ]
    },
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
        objectConfig: {
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
        },

        // Config as an array
        arrayConfig: {
            type: "array",
            items: {
                anyOf: [
                    { type: "string" },
                    { $ref: "#/definitions/objectConfig" },
                    { $ref: "#/definitions/overrideConfig" },
                    { $ref: "#/definitions/arrayConfig" }
                ]
            },
            additionalItems: false
        }
    },

    anyOf: [
        { $ref: "#/definitions/objectConfig" },
        { $ref: "#/definitions/arrayConfig" }
    ]
};

module.exports = configSchema;
