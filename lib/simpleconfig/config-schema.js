/**
 * @fileoverview ConfigSchema
 * @author Nicholas C. Zakas
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { ObjectSchema } = require("@humanwhocodes/object-schema");
const deepMerge = require("deepmerge");
const ConfigOps = require("../config/config-ops");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

function assignThrough(value1, value2) {
    if (value1 === undefined) {
        return value2;
    }

    return (value1 === undefined) ? value2 : value1;
}

function assignObjectThrough(value1, value2) {
    if (value1 === undefined) {
        return Object.assign({}, value2);
    }

    if (value2 === undefined) {
        return Object.assign({}, value1);
    }

    return Object.assign({}, value1, value2);
}

function mergeObjectThrough(value1, value2) {
    const validValue1 = (value1 != null);
    const validValue2 = (value2 != null);

    if (validValue1 && validValue2) {
        return deepMerge(value1, value2);
    }

    if (validValue1 && !validValue2) {
        return Object.assign({}, value1);
    }

    if (validValue2 && !validValue1) {
        return Object.assign({}, value2);
    }

    return undefined;
}


function assertIsArray(value, name) {
    if (!Array.isArray(value)) {
        throw new TypeError(`Expected key "${name}" to be an array.`);
    }
}

function assertIsNotArray(value, name) {
    if (Array.isArray(value)) {
        throw new TypeError(`Expected key "${name}" to not be an array.`);
    }
}

function assertIsObject(value, name) {
    if (value == null || typeof value !== "object") {
        throw new TypeError(`Expected key "${name}" to be an object.`);
    }

}

function assertIsArrayOfStrings(value, name) {
    assertIsArray(value, name);

    if (value.some(item => typeof item !== "string")) {
        throw new TypeError(`Expected "${name}" to only contain strings.`);
    }
}

const defsSchema = new ObjectSchema({
    ruleNamespaces: {
        required: false,
        merge(value1, value2) {
            if (value1 == undefined) {
                return value2;
            }

            if (value2 == undefined) {
                return value1;
            }

            for (const key in Object.keys(value1)) {
                if (key in value2) {
                    throw new Error(`Duplicate rule namespace "${key}" not allowed.`);
                }
            }

            return Object.assign({}, value1, value2);
        },
        validate(value) {
            assertIsObject(value);
        }
    }
});

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

module.exports = new ObjectSchema({
    files: {
        required: false,
        merge() {
            return undefined;
        },
        validate(value) {
            if (value !== undefined) {

                // assertIsArrayOfStrings(value, this.name);
            }
        }
    },
    ignores: {
        required: false,
        requires: ["files"],
        merge() {
            return undefined;
        },
        validate(value) {
            if (value !== undefined) {

                // assertIsArrayOfStrings(value, this.name);
            }
        }
    },
    globals: {
        required: false,
        merge: assignObjectThrough,
        validate(value) {
            assertIsObject(value, this.name);
        }
    },
    settings: {
        required: false,
        merge: mergeObjectThrough,
        validate(value) {
            assertIsObject(value, this.name);
        }
    },
    parserOptions: {
        required: false,
        merge: mergeObjectThrough,
        validate(value) {
            assertIsObject(value, this.name);
        }
    },
    rules: {
        required: false,
        merge(object1, object2) {
            const validValue1 = (object1 != null);
            const validValue2 = (object2 != null);

            if (validValue1 && validValue2) {
                const result = {};
                const keys = new Set([...Object.keys(object1), ...Object.keys(object2)]);

                for (const key of keys) {
                    if ((key in object1) && (key in object2)) {
                        result[key] = ConfigOps.merge(value1, value2, false, true);
                    } else if (key in object1) {
                        result[key] = object1[key];
                    } else {
                        result[key] = object2[key];
                    }
                }

                return result;
            }

            return mergeObjectThrough(object1, object2);
        },
        validate(value) {
            assertIsObject(value, this.name);
        }
    },
    defs: {
        required: false,
        merge(value1, value2) {
            
            if (!value1) {
                return value2;
            }

            if (!value2) {
                return value1;
            }
            
            return defsSchema.merge(value1, value2);
        },
        validate(value) {
            assertIsObject(value, this.name);
            defsSchema.validate(value);
        }
    },
    processor: {
        required: false,
        merge: assignThrough,
        validate(value) {
            assertIsObject(value, this.name);
        }
    }

});
