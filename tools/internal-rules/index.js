"use strict";

const fs = require("fs");
const path = require("path");

module.exports = { // eslint-disable-line rulesdir/no-invalid-meta
    rules: fs.readdirSync(__dirname).reduce((rules, filename) => {
        if (filename !== "index.js") {
            rules[path.basename(filename, ".js")] = require(`./${filename}`);
        }
        return rules;
    }, {})
};
