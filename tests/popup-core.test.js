"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../scripts/lib/usage-core.js");

test("sanitizeDomain strips a single leading dot", () => {
    assert.equal(core.sanitizeDomain(".my.salesforce.com"), "my.salesforce.com");
    assert.equal(core.sanitizeDomain("my.salesforce.com"), "my.salesforce.com");
});

test("sanitizeDomain throws on a missing domain", () => {
    assert.throws(() => core.sanitizeDomain(""), /domain not returned/i);
    assert.throws(() => core.sanitizeDomain(null), /domain not returned/i);
    assert.throws(() => core.sanitizeDomain(undefined), /domain not returned/i);
});

test("buildFieldKey and parseFieldKey round-trip", () => {
    assert.equal(core.buildFieldKey("Account", "Industry"), "Account:Industry");
    assert.deepEqual(core.parseFieldKey("Account:Industry"), {
        sobject: "Account",
        field: "Industry"
    });
});

test("parseFieldKey rejects malformed keys", () => {
    assert.equal(core.parseFieldKey(""), null);
    assert.equal(core.parseFieldKey("NoColon"), null);
    assert.equal(core.parseFieldKey(":Field"), null);
    assert.equal(core.parseFieldKey("Sobject:"), null);
    assert.equal(core.parseFieldKey(null), null);
});

test("isFilterableField rejects textarea and address, allows the rest", () => {
    assert.equal(core.isFilterableField({ type: "textarea" }), false);
    assert.equal(core.isFilterableField({ type: "TextArea" }), false);
    assert.equal(core.isFilterableField({ type: "address" }), false);
    assert.equal(core.isFilterableField({ type: "Address" }), false);
    assert.equal(core.isFilterableField({ type: "picklist" }), true);
    assert.equal(core.isFilterableField({ type: "string" }), true);
});

test("isFilterableField defaults to filterable when type is missing", () => {
    assert.equal(core.isFilterableField(null), true);
    assert.equal(core.isFilterableField({}), true);
});

test("buildExplainUrl injects sobject, field, and api version", () => {
    const url = core.buildExplainUrl("Account", "Industry", "v59.0");
    assert.match(url, /^\/services\/data\/v59\.0\/tooling\/query\/\?explain=/);
    // The SOQL is URL-encoded; decode the explain param and check it round-trips.
    const explain = decodeURIComponent(url.split("explain=")[1]);
    assert.equal(explain, "SELECT count(Id) FROM Account WHERE Industry != null");
});

test("parsePlanFromResponse computes estimated counts and ratio", () => {
    const body = { plans: [{ cardinality: 30, sobjectCardinality: 120 }] };
    assert.deepEqual(core.parsePlanFromResponse(body), {
        nonNullCount: 30,
        sobjectCount: 120,
        nonNullPercentage: 0.25
    });
});

test("parsePlanFromResponse guards divide-by-zero", () => {
    const body = { plans: [{ cardinality: 0, sobjectCardinality: 0 }] };
    assert.equal(core.parsePlanFromResponse(body).nonNullPercentage, 0);
});

test("parsePlanFromResponse returns null without cardinality data", () => {
    assert.equal(core.parsePlanFromResponse(null), null);
    assert.equal(core.parsePlanFromResponse({}), null);
    assert.equal(core.parsePlanFromResponse({ plans: [] }), null);
    assert.equal(core.parsePlanFromResponse({ plans: [{ cardinality: 5 }] }), null);
    assert.equal(core.parsePlanFromResponse({ plans: [{ sobjectCardinality: 5 }] }), null);
});

test("extractCompositeError reads array, object, and empty bodies", () => {
    assert.equal(core.extractCompositeError([{ message: "Bad field" }]), "Bad field");
    assert.equal(core.extractCompositeError({ message: "Boom" }), "Boom");
    assert.equal(core.extractCompositeError(null), "Unknown error.");
});

test("extractCompositeError falls back to JSON when no message present", () => {
    assert.equal(core.extractCompositeError([{ code: 17 }]), JSON.stringify({ code: 17 }));
    assert.equal(core.extractCompositeError({ code: 42 }), JSON.stringify({ code: 42 }));
});

test("normalizeTimelineRows computes each value's share of its month", () => {
    const rows = [
        { year: 2025, month: 1, value: "Won", count: 3 },
        { year: 2025, month: 1, value: "Lost", count: 1 },
        { year: 2025, month: 2, value: "Won", count: 5 }
    ];
    const out = core.normalizeTimelineRows(rows);
    const jan = out.filter((r) => r.month === 1);
    assert.equal(jan.find((r) => r.value === "Won").percentage, 0.75);
    assert.equal(jan.find((r) => r.value === "Lost").percentage, 0.25);
    assert.equal(out.find((r) => r.month === 2).percentage, 1);
});

test("normalizeTimelineRows drops zero-count rows and defaults missing values to null", () => {
    const rows = [
        { year: 2025, month: 1, count: 4 },
        { year: 2025, month: 1, value: "X", count: 0 }
    ];
    const out = core.normalizeTimelineRows(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].value, null);
});

test("normalizeTimelineRows handles empty/undefined input", () => {
    assert.deepEqual(core.normalizeTimelineRows([]), []);
    assert.deepEqual(core.normalizeTimelineRows(), []);
});

test("isAuthFailureStatus triggers a session refresh only on 401", () => {
    assert.equal(core.isAuthFailureStatus(401), true);
    // 403 is excluded on purpose (real permission/IP errors must not retry-loop).
    assert.equal(core.isAuthFailureStatus(403), false);
    assert.equal(core.isAuthFailureStatus(200), false);
    assert.equal(core.isAuthFailureStatus(500), false);
    assert.equal(core.isAuthFailureStatus(undefined), false);
});

test("pickLatestApiVersion chooses the highest version numerically, not by order", () => {
    const versions = [
        { label: "Spring '23", url: "/services/data/v57.0", version: "57.0" },
        { label: "Winter '24", url: "/services/data/v59.0", version: "59.0" },
        { label: "Summer '23", url: "/services/data/v58.0", version: "58.0" }
    ];
    assert.equal(core.pickLatestApiVersion(versions, "v60.0"), "v59.0");
});

test("pickLatestApiVersion handles double-digit minor versions", () => {
    const versions = [
        { version: "9.0" },
        { version: "63.0" },
        { version: "60.0" }
    ];
    assert.equal(core.pickLatestApiVersion(versions, "v50.0"), "v63.0");
});

test("pickLatestApiVersion falls back for empty/invalid input", () => {
    assert.equal(core.pickLatestApiVersion([], "v60.0"), "v60.0");
    assert.equal(core.pickLatestApiVersion(null, "v60.0"), "v60.0");
    assert.equal(core.pickLatestApiVersion([{ label: "x" }], "v60.0"), "v60.0");
});

test("extractRecordCount reads the count for the requested object", () => {
    const response = {
        sObjects: [
            { name: "Account", count: 1200 },
            { name: "Contact", count: 3400 }
        ]
    };
    assert.equal(core.extractRecordCount(response, "Account"), 1200);
    assert.equal(core.extractRecordCount(response, "Contact"), 3400);
});

test("extractRecordCount returns null to trigger the COUNT() fallback", () => {
    assert.equal(core.extractRecordCount({ sObjects: [] }, "Account"), null);
    assert.equal(core.extractRecordCount({ sObjects: [{ name: "Account" }] }, "Account"), null);
    assert.equal(core.extractRecordCount({}, "Account"), null);
    assert.equal(core.extractRecordCount(null, "Account"), null);
});

test("extractRecordCount accepts a zero count", () => {
    assert.equal(core.extractRecordCount({ sObjects: [{ name: "Account", count: 0 }] }, "Account"), 0);
});

test("customFieldDeveloperName strips __c and namespace prefixes", () => {
    assert.equal(core.customFieldDeveloperName("Foo__c"), "Foo");
    assert.equal(core.customFieldDeveloperName("ns__Foo__c"), "Foo");
    assert.equal(core.customFieldDeveloperName("My_Field__c"), "My_Field");
});

test("customFieldDeveloperName returns null for standard fields", () => {
    assert.equal(core.customFieldDeveloperName("Industry"), null);
    assert.equal(core.customFieldDeveloperName("Name"), null);
    assert.equal(core.customFieldDeveloperName(null), null);
    assert.equal(core.customFieldDeveloperName(42), null);
});

test("buildCustomFieldIdQuery uses EntityDefinition and DeveloperName", () => {
    const q = core.buildCustomFieldIdQuery("Account", "My_Field");
    assert.match(q, /FROM CustomField/);
    assert.match(q, /EntityDefinition\.QualifiedApiName = 'Account'/);
    assert.match(q, /DeveloperName = 'My_Field'/);
    assert.match(q, /LIMIT 1$/);
});

test("buildCustomFieldIdQuery escapes single quotes to prevent SOQL injection", () => {
    const q = core.buildCustomFieldIdQuery("Acc'ount", "Fie'ld");
    assert.match(q, /'Acc\\'ount'/);
    assert.match(q, /'Fie\\'ld'/);
});

test("buildDependencyQuery targets RefMetadataComponentId", () => {
    const q = core.buildDependencyQuery("00N000000000001");
    assert.match(q, /FROM MetadataComponentDependency/);
    assert.match(q, /RefMetadataComponentId = '00N000000000001'/);
});

test("extractFirstId returns the first record id or null", () => {
    assert.equal(core.extractFirstId({ records: [{ Id: "00Nabc" }, { Id: "00Nxyz" }] }), "00Nabc");
    assert.equal(core.extractFirstId({ records: [] }), null);
    assert.equal(core.extractFirstId({}), null);
    assert.equal(core.extractFirstId(null), null);
});

test("groupDependencies groups by type with de-duped sorted names", () => {
    const rows = [
        { MetadataComponentType: "Layout", MetadataComponentName: "Account Layout" },
        { MetadataComponentType: "Flow", MetadataComponentName: "Update_Rating" },
        { MetadataComponentType: "Layout", MetadataComponentName: "Account Layout" },
        { MetadataComponentType: "Layout", MetadataComponentName: "Sales Layout" }
    ];
    const grouped = core.groupDependencies(rows);
    assert.deepEqual(grouped, [
        { type: "Flow", count: 1, names: ["Update_Rating"] },
        { type: "Layout", count: 2, names: ["Account Layout", "Sales Layout"] }
    ]);
});

test("groupDependencies tolerates empty input and missing fields", () => {
    assert.deepEqual(core.groupDependencies([]), []);
    assert.deepEqual(core.groupDependencies(null), []);
    const grouped = core.groupDependencies([{}, null]);
    assert.deepEqual(grouped, [{ type: "Unknown", count: 1, names: ["(unnamed)"] }]);
});
