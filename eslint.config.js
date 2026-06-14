"use strict";

// Flat ESLint config. The extension's scripts run in three different contexts
// (browser pages, the service worker, content scripts) plus Node for the tests,
// so globals are scoped per file group.

const js = require("@eslint/js");

const browserGlobals = {
    window: "readonly",
    document: "readonly",
    location: "readonly",
    fetch: "readonly",
    console: "readonly",
    URL: "readonly",
    URLSearchParams: "readonly",
    setTimeout: "readonly",
    clearTimeout: "readonly",
    chrome: "readonly",
    globalThis: "readonly"
};

const workerGlobals = {
    self: "readonly",
    globalThis: "readonly",
    importScripts: "readonly",
    fetch: "readonly",
    console: "readonly",
    chrome: "readonly"
};

const sharedRules = {
    "no-unused-vars": ["warn", { args: "none" }],
    "no-undef": "error",
    "no-console": "off"
};

module.exports = [
    { ignores: ["node_modules/**", "*.zip"] },
    js.configs.recommended,
    {
        // Popup and report pages (classic browser scripts).
        files: ["scripts/popup.js", "scripts/report.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "script",
            globals: browserGlobals
        },
        rules: sharedRules
    },
    {
        // Content script (ES module running in the page's isolated world).
        files: ["scripts/content.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: { ...browserGlobals, location: "readonly" }
        },
        rules: sharedRules
    },
    {
        // Service worker.
        files: ["scripts/background.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "script",
            globals: workerGlobals
        },
        rules: sharedRules
    },
    {
        // Shared library: loaded as a classic script, a worker import, and a CJS
        // module, so it sees both globalThis and the CommonJS `module`.
        files: ["scripts/lib/usage-core.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "script",
            globals: { globalThis: "readonly", module: "writable", self: "readonly" }
        },
        rules: sharedRules
    },
    {
        // Node test files.
        files: ["tests/**/*.js", "eslint.config.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: { require: "readonly", module: "writable", __dirname: "readonly", console: "readonly" }
        },
        rules: sharedRules
    }
];
