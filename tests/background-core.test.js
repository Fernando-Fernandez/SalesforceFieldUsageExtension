"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../scripts/lib/usage-core.js");

test("parseOrgIdFromCookie returns the prefix before the bang", () => {
    assert.equal(core.parseOrgIdFromCookie("00D000000000001!sessionToken"), "00D000000000001");
});

test("parseOrgIdFromCookie returns the whole value when there is no bang", () => {
    assert.equal(core.parseOrgIdFromCookie("00D000000000001"), "00D000000000001");
});

test("parseOrgIdFromCookie returns null for empty/non-string/empty-prefix values", () => {
    assert.equal(core.parseOrgIdFromCookie(""), null);
    assert.equal(core.parseOrgIdFromCookie(null), null);
    assert.equal(core.parseOrgIdFromCookie(undefined), null);
    assert.equal(core.parseOrgIdFromCookie(12345), null);
    // Leading bang -> empty org id -> null (must not match every cookie).
    assert.equal(core.parseOrgIdFromCookie("!justatoken"), null);
});

test("findSessionCookieForOrg matches the cookie for the requested org", () => {
    const cookies = [
        { value: "00DAAA!tokenA", domain: ".a.my.salesforce.com" },
        { value: "00DBBB!tokenB", domain: ".b.my.salesforce.com" }
    ];
    const match = core.findSessionCookieForOrg(cookies, "00DBBB");
    assert.equal(match.value, "00DBBB!tokenB");
});

test("findSessionCookieForOrg does not match on a partial/overlapping org id", () => {
    // "00DBBB" must not match "00DBBBB!..." — the bang boundary matters.
    const cookies = [{ value: "00DBBBB!token", domain: ".x.my.salesforce.com" }];
    assert.equal(core.findSessionCookieForOrg(cookies, "00DBBB"), null);
});

test("findSessionCookieForOrg returns null for no match, empty org, or bad input", () => {
    const cookies = [{ value: "00DAAA!tokenA" }];
    assert.equal(core.findSessionCookieForOrg(cookies, "00DZZZ"), null);
    assert.equal(core.findSessionCookieForOrg(cookies, ""), null);
    assert.equal(core.findSessionCookieForOrg(cookies, null), null);
    assert.equal(core.findSessionCookieForOrg(null, "00DAAA"), null);
});

test("findSessionCookieForOrg tolerates malformed cookie entries", () => {
    const cookies = [null, {}, { value: 42 }, { value: "00DAAA!tokenA" }];
    const match = core.findSessionCookieForOrg(cookies, "00DAAA");
    assert.equal(match.value, "00DAAA!tokenA");
});

test("serializeTabSessions flattens a Map into storable entries", () => {
    const map = new Map([
        ["https://a/lightning", { domain: ".a.my.salesforce.com", session: "s1" }],
        ["https://b/lightning", { domain: ".b.my.salesforce.com", session: "s2" }]
    ]);
    assert.deepEqual(core.serializeTabSessions(map), [
        { tabUrl: "https://a/lightning", domain: ".a.my.salesforce.com", session: "s1" },
        { tabUrl: "https://b/lightning", domain: ".b.my.salesforce.com", session: "s2" }
    ]);
});

test("serializeTabSessions drops incomplete entries and handles non-Maps", () => {
    const map = new Map([
        ["https://good", { domain: "d", session: "s" }],
        ["https://nodomain", { session: "s" }],
        ["https://nosession", { domain: "d" }]
    ]);
    assert.deepEqual(core.serializeTabSessions(map), [
        { tabUrl: "https://good", domain: "d", session: "s" }
    ]);
    assert.deepEqual(core.serializeTabSessions(null), []);
    assert.deepEqual(core.serializeTabSessions({}), []);
});

test("deserializeTabSessions keeps only complete entries", () => {
    const stored = [
        { tabUrl: "https://good", domain: "d", session: "s" },
        { tabUrl: "https://missing-session", domain: "d" },
        { domain: "d", session: "s" },
        null,
        "garbage"
    ];
    assert.deepEqual(core.deserializeTabSessions(stored), [
        { tabUrl: "https://good", domain: "d", session: "s" }
    ]);
});

test("deserializeTabSessions returns [] for non-array input", () => {
    assert.deepEqual(core.deserializeTabSessions(undefined), []);
    assert.deepEqual(core.deserializeTabSessions(null), []);
    assert.deepEqual(core.deserializeTabSessions({}), []);
});

test("pruneReportStore keeps everything when under the cap", () => {
    const store = {
        a: { generatedAt: 1 },
        b: { generatedAt: 2 }
    };
    assert.deepEqual(core.pruneReportStore(store, 10), store);
});

test("pruneReportStore retains the most recent reports by generatedAt", () => {
    const store = {
        oldest: { generatedAt: 100 },
        middle: { generatedAt: 200 },
        newest: { generatedAt: 300 }
    };
    const pruned = core.pruneReportStore(store, 2);
    assert.deepEqual(Object.keys(pruned).sort(), ["middle", "newest"]);
    assert.equal(pruned.oldest, undefined);
});

test("pruneReportStore treats missing generatedAt as oldest", () => {
    const store = {
        withTs: { generatedAt: 500 },
        noTs: { reportId: "noTs" }
    };
    const pruned = core.pruneReportStore(store, 1);
    assert.deepEqual(Object.keys(pruned), ["withTs"]);
});

test("pruneReportStore returns an empty object for non-positive caps or empty input", () => {
    assert.deepEqual(core.pruneReportStore({ a: { generatedAt: 1 } }, 0), {});
    assert.deepEqual(core.pruneReportStore({ a: { generatedAt: 1 } }, -3), {});
    assert.deepEqual(core.pruneReportStore({}, 5), {});
    assert.deepEqual(core.pruneReportStore(null, 5), {});
});

test("pruneReportStore returns a new object (does not mutate input)", () => {
    const store = { a: { generatedAt: 1 } };
    const pruned = core.pruneReportStore(store, 10);
    assert.notEqual(pruned, store);
    assert.deepEqual(pruned, store);
});

test("serialize/deserialize round-trip preserves complete entries", () => {
    const map = new Map([
        ["https://a", { domain: ".a", session: "s1" }],
        ["https://b", { domain: ".b", session: "s2" }]
    ]);
    const restored = core.deserializeTabSessions(core.serializeTabSessions(map));
    assert.deepEqual(restored, [
        { tabUrl: "https://a", domain: ".a", session: "s1" },
        { tabUrl: "https://b", domain: ".b", session: "s2" }
    ]);
});
