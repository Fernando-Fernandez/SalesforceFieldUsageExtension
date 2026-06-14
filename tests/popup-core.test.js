"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../scripts/lib/usage-core.js");

test("sanitizeDomain strips a single leading dot", () => {
    assert.equal(core.sanitizeDomain(".my.salesforce.com"), "my.salesforce.com");
    assert.equal(core.sanitizeDomain("my.salesforce.com"), "my.salesforce.com");
});

test("selectionsToStorage serializes objects and the field Map, dropping empties", () => {
    const fields = new Map([
        ["Account", ["Industry", "Type"]],
        ["Contact", []]
    ]);
    assert.deepEqual(core.selectionsToStorage(["Account", "Contact"], fields), {
        sobjects: ["Account", "Contact"],
        fields: { Account: ["Industry", "Type"] }
    });
});

test("selectionsToStorage handles missing/invalid input", () => {
    assert.deepEqual(core.selectionsToStorage(null, null), { sobjects: [], fields: {} });
});

test("selectionsFromStorage rebuilds selection and drops objects no longer in the org", () => {
    const stored = { sobjects: ["Account", "Gone__c"], fields: { Account: ["Industry"], Gone__c: ["X__c"] } };
    const { selectedSObjects, selectedFields } = core.selectionsFromStorage(stored, new Set(["Account", "Contact"]));
    assert.deepEqual(selectedSObjects, ["Account"]);
    assert.equal(selectedFields instanceof Map, true);
    assert.deepEqual(selectedFields.get("Account"), ["Industry"]);
    assert.equal(selectedFields.has("Gone__c"), false);
});

test("selectionsFromStorage tolerates empty/missing input", () => {
    const empty = core.selectionsFromStorage(null, new Set(["Account"]));
    assert.deepEqual(empty.selectedSObjects, []);
    assert.equal(empty.selectedFields.size, 0);
    // validNames may also be a plain array
    const fromArray = core.selectionsFromStorage({ sobjects: ["Account"], fields: {} }, ["Account"]);
    assert.deepEqual(fromArray.selectedSObjects, ["Account"]);
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

test("parseLimitInfo extracts api usage from the Sforce-Limit-Info header", () => {
    assert.deepEqual(core.parseLimitInfo("api-usage=12345/15000"), { used: 12345, limit: 15000 });
    // Tolerates a trailing per-app clause.
    assert.deepEqual(
        core.parseLimitInfo("api-usage=10/100; per-app-api-usage=2/50(MyApp)"),
        { used: 10, limit: 100 }
    );
});

test("parseLimitInfo returns null for missing/invalid headers", () => {
    assert.equal(core.parseLimitInfo(null), null);
    assert.equal(core.parseLimitInfo(""), null);
    assert.equal(core.parseLimitInfo("something-else"), null);
});

test("estimateScanApiCalls: distribution = objects + 2 per field", () => {
    assert.equal(core.estimateScanApiCalls({ mode: "distribution", sobjectCount: 2, fieldCount: 5 }), 12);
});

test("estimateScanApiCalls: summary = ceil(fields/5) batches + 1 per object", () => {
    assert.equal(core.estimateScanApiCalls({ mode: "summary", sobjectCount: 2, fieldCount: 11 }), 5);
    assert.equal(core.estimateScanApiCalls({ mode: "summary", sobjectCount: 1, fieldCount: 0 }), 1);
});

test("estimateScanApiCalls tolerates missing fields", () => {
    assert.equal(core.estimateScanApiCalls({}), 0);
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

test("buildDistributionRows maps records to rows with per-total percentages", () => {
    const records = [
        { Status__c: "Open", cnt: 30 },
        { Status__c: "Closed", cnt: 10 }
    ];
    const { rows, truncated } = core.buildDistributionRows(records, "Status__c", 40, 100);
    assert.equal(truncated, false);
    assert.deepEqual(rows, [
        { value: "Open", count: 30, percentage: 0.75 },
        { value: "Closed", count: 10, percentage: 0.25 }
    ]);
});

test("buildDistributionRows treats exactly `limit` distinct values as NOT truncated", () => {
    // The caller fetches limit+1; exactly `limit` rows means nothing was dropped.
    const records = Array.from({ length: 3 }, (_, i) => ({ F__c: `v${i}`, cnt: 1 }));
    const { rows, truncated } = core.buildDistributionRows(records, "F__c", 3, 3);
    assert.equal(truncated, false);
    assert.equal(rows.length, 3);
});

test("buildDistributionRows marks truncated and caps rows when over `limit`", () => {
    // limit+1 rows came back -> there are more than `limit` distinct values.
    const records = Array.from({ length: 4 }, (_, i) => ({ F__c: `v${i}`, cnt: 5 - i }));
    const { rows, truncated } = core.buildDistributionRows(records, "F__c", 100, 3);
    assert.equal(truncated, true);
    assert.equal(rows.length, 3, "only the first `limit` rows are displayed");
    assert.deepEqual(rows.map((r) => r.value), ["v0", "v1", "v2"]);
});

test("buildDistributionRows drops zero counts, defaults missing value to null, handles no total", () => {
    const records = [
        { F__c: "a", cnt: 0 },
        { cnt: 5 }
    ];
    const { rows } = core.buildDistributionRows(records, "F__c", 0, 100);
    assert.deepEqual(rows, [{ value: null, count: 5, percentage: 0 }]);
});

test("buildDistributionRows tolerates non-array input", () => {
    assert.deepEqual(core.buildDistributionRows(null, "F__c", 10, 100), { rows: [], truncated: false });
});

test("extractUsedPicklistValues returns used single-select values, skipping NULL", () => {
    const rows = [
        { value: "Open", count: 5 },
        { value: "Closed", count: 3 },
        { value: null, count: 2 }
    ];
    assert.deepEqual(core.extractUsedPicklistValues(rows, false), [
        { value: "Open", count: 5 },
        { value: "Closed", count: 3 }
    ]);
});

test("extractUsedPicklistValues splits multi-select combinations and sums counts", () => {
    const rows = [
        { value: "A;B", count: 2 },
        { value: "B;C", count: 3 },
        { value: "A", count: 1 }
    ];
    const used = core.extractUsedPicklistValues(rows, true);
    const asMap = Object.fromEntries(used.map((u) => [u.value, u.count]));
    assert.deepEqual(asMap, { A: 3, B: 5, C: 3 });
});

test("analyzePicklistHealth flags unused defined values and non-conforming data", () => {
    const defined = [
        { value: "Open", label: "Open" },
        { value: "Closed", label: "Closed" },
        { value: "OnHold", label: "On Hold" }
    ];
    const used = [
        { value: "Open", count: 10 },
        { value: "Legacy", count: 4 }
    ];
    const { unused, nonConforming } = core.analyzePicklistHealth(defined, used);
    assert.deepEqual(unused, [
        { value: "Closed", label: "Closed" },
        { value: "OnHold", label: "On Hold" }
    ]);
    assert.deepEqual(nonConforming, [{ value: "Legacy", count: 4 }]);
});

test("analyzePicklistHealth returns unused=null for a truncated sample but still flags non-conforming", () => {
    const defined = [{ value: "A", label: "A" }, { value: "B", label: "B" }];
    // "B" is absent from this (truncated) sample, but we must not call it unused
    // because it could be used beyond the top-N cap.
    const used = [{ value: "A", count: 9 }, { value: "Legacy", count: 1 }];
    const result = core.analyzePicklistHealth(defined, used, true);
    assert.equal(result.unused, null);
    assert.deepEqual(result.nonConforming, [{ value: "Legacy", count: 1 }]);
});

test("analyzePicklistHealth reports a clean picklist as fully healthy", () => {
    const defined = [{ value: "A", label: "A" }, { value: "B", label: "B" }];
    const used = [{ value: "A", count: 1 }, { value: "B", count: 2 }];
    assert.deepEqual(core.analyzePicklistHealth(defined, used), { unused: [], nonConforming: [] });
});

test("analyzePicklistHealth tolerates empty/invalid input", () => {
    assert.deepEqual(core.analyzePicklistHealth(null, null), { unused: [], nonConforming: [] });
    assert.deepEqual(core.analyzePicklistHealth([{ value: "A", label: "A" }], []), {
        unused: [{ value: "A", label: "A" }],
        nonConforming: []
    });
});

test("parseCustomFieldName splits namespace and developer name", () => {
    assert.deepEqual(core.parseCustomFieldName("Foo__c"), { namespace: null, developerName: "Foo" });
    assert.deepEqual(core.parseCustomFieldName("ns__Foo__c"), { namespace: "ns", developerName: "Foo" });
    // Single underscores belong to the developer name; only the namespace uses "__".
    assert.deepEqual(core.parseCustomFieldName("My_Field__c"), { namespace: null, developerName: "My_Field" });
    assert.deepEqual(core.parseCustomFieldName("pkg__My_Field__c"), { namespace: "pkg", developerName: "My_Field" });
});

test("parseCustomFieldName returns null for standard/invalid fields", () => {
    assert.equal(core.parseCustomFieldName("Industry"), null);
    assert.equal(core.parseCustomFieldName("Name"), null);
    assert.equal(core.parseCustomFieldName(null), null);
    assert.equal(core.parseCustomFieldName(42), null);
});

test("buildCustomFieldIdQuery constrains NamespacePrefix to null when unmanaged", () => {
    const q = core.buildCustomFieldIdQuery("Account", "My_Field", null);
    assert.match(q, /FROM CustomField/);
    assert.match(q, /EntityDefinition\.QualifiedApiName = 'Account'/);
    assert.match(q, /DeveloperName = 'My_Field'/);
    assert.match(q, /NamespacePrefix = null/);
    assert.match(q, /LIMIT 1$/);
});

test("buildCustomFieldIdQuery constrains NamespacePrefix to the package when managed", () => {
    const q = core.buildCustomFieldIdQuery("Account", "Status", "pkg");
    assert.match(q, /DeveloperName = 'Status'/);
    assert.match(q, /NamespacePrefix = 'pkg'/);
    assert.doesNotMatch(q, /NamespacePrefix = null/);
});

test("buildCustomFieldIdQuery escapes single quotes to prevent SOQL injection", () => {
    const q = core.buildCustomFieldIdQuery("Acc'ount", "Fie'ld", "n's");
    assert.match(q, /'Acc\\'ount'/);
    assert.match(q, /'Fie\\'ld'/);
    assert.match(q, /'n\\'s'/);
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
