"use strict";
const { tokenize, statements } = require("./value-origin-tokens");
module.exports = { tokenize, statements, ...require("./value-origin-model") };
