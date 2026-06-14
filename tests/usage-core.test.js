"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../scripts/lib/usage-core.js");

test("chunkArray splits into fixed-size groups", () => {
    assert.deepEqual(core.chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("chunkArray returns one chunk when size exceeds length", () => {
    assert.deepEqual(core.chunkArray([1, 2], 10), [[1, 2]]);
});

test("chunkArray is safe for empty/invalid input", () => {
    assert.deepEqual(core.chunkArray([], 3), []);
    assert.deepEqual(core.chunkArray(null, 3), []);
    assert.deepEqual(core.chunkArray([1, 2, 3], 0), []);
});

test("toCsv joins headers and rows with CRLF", () => {
    const csv = core.toCsv(["A", "B"], [[1, 2], [3, 4]]);
    assert.equal(csv, "A,B\r\n1,2\r\n3,4");
});

test("toCsv quotes cells containing comma, quote, or newline and doubles quotes", () => {
    const csv = core.toCsv(["X"], [["a,b"], ['he said "hi"'], ["line1\nline2"]]);
    assert.equal(csv, 'X\r\n"a,b"\r\n"he said ""hi"""\r\n"line1\nline2"');
});

test("toCsv renders null/undefined as empty cells", () => {
    assert.equal(core.toCsv(["A", "B", "C"], [[null, undefined, 0]]), "A,B,C\r\n,,0");
});

test("toCsv handles empty/missing rows", () => {
    assert.equal(core.toCsv(["A", "B"], []), "A,B");
    assert.equal(core.toCsv(["A"], null), "A");
});

test("cleanSObjectLabel falls back to the API name for missing/placeholder labels", () => {
    assert.equal(core.cleanSObjectLabel("Account", "Account"), "Account");
    assert.equal(core.cleanSObjectLabel("", "Foo__c"), "Foo__c");
    assert.equal(core.cleanSObjectLabel(null, "Foo__c"), "Foo__c");
    assert.equal(
        core.cleanSObjectLabel("__MISSING LABEL__ PropertyFile - val Appointment", "Appointment__x"),
        "Appointment__x"
    );
});

test("formatNumber renders an em dash for nullish/NaN", () => {
    assert.equal(core.formatNumber(null), "—");
    assert.equal(core.formatNumber(undefined), "—");
    assert.equal(core.formatNumber("not-a-number"), "—");
});

test("formatNumber accepts numbers and numeric strings", () => {
    assert.equal(core.formatNumber(0), (0).toLocaleString());
    assert.equal(core.formatNumber(1234), (1234).toLocaleString());
    assert.equal(core.formatNumber("1234"), (1234).toLocaleString());
});

test("formatPercentage scales a 0..1 ratio to a 2-decimal percent", () => {
    assert.equal(core.formatPercentage(0), "0.00%");
    assert.equal(core.formatPercentage(0.5), "50.00%");
    assert.equal(core.formatPercentage(1), "100.00%");
    assert.equal(core.formatPercentage(0.12345), "12.35%");
});

test("formatPercentage returns em dash for nullish/NaN", () => {
    assert.equal(core.formatPercentage(null), "—");
    assert.equal(core.formatPercentage(undefined), "—");
    assert.equal(core.formatPercentage("abc"), "—");
});

test("normalizePercentage clamps to the 0..1 range", () => {
    assert.equal(core.normalizePercentage(-0.5), 0);
    assert.equal(core.normalizePercentage(0.4), 0.4);
    assert.equal(core.normalizePercentage(1.5), 1);
});

test("normalizePercentage treats NaN/Infinity/non-numeric as 0", () => {
    assert.equal(core.normalizePercentage(NaN), 0);
    assert.equal(core.normalizePercentage("not-a-number"), 0);
    assert.equal(core.normalizePercentage(Number.POSITIVE_INFINITY), 0);
    assert.equal(core.normalizePercentage(Number.NEGATIVE_INFINITY), 0);
});

test("formatDistributionValue labels null/undefined as NULL", () => {
    assert.equal(core.formatDistributionValue(null), "NULL");
    assert.equal(core.formatDistributionValue(undefined), "NULL");
});

test("formatDistributionValue stringifies primitives", () => {
    assert.equal(core.formatDistributionValue("Closed Won"), "Closed Won");
    assert.equal(core.formatDistributionValue(42), "42");
    assert.equal(core.formatDistributionValue(false), "false");
});

test("formatDistributionValue prefers displayValue then value for objects", () => {
    assert.equal(core.formatDistributionValue({ displayValue: "Shown", value: "raw" }), "Shown");
    assert.equal(core.formatDistributionValue({ value: "raw" }), "raw");
    assert.equal(core.formatDistributionValue({ a: 1 }), JSON.stringify({ a: 1 }));
});

test("getSortValue maps sort keys onto result fields", () => {
    const row = {
        sobjectLabel: "Account",
        fieldLabel: "Industry",
        sobjectCount: 10,
        nonNullCount: 7,
        nonNullPercentage: 0.7,
        status: "Success"
    };
    assert.equal(core.getSortValue(row, "sobject"), "Account");
    assert.equal(core.getSortValue(row, "field"), "Industry");
    assert.equal(core.getSortValue(row, "sobjectCount"), 10);
    assert.equal(core.getSortValue(row, "nonNullCount"), 7);
    assert.equal(core.getSortValue(row, "nonNullPercentage"), 0.7);
    assert.equal(core.getSortValue(row, "status"), "Success");
    assert.equal(core.getSortValue(row, "unknown"), null);
});

test("sortResults sorts numbers ascending and descending", () => {
    const rows = [
        { fieldLabel: "B", nonNullCount: 3 },
        { fieldLabel: "A", nonNullCount: 1 },
        { fieldLabel: "C", nonNullCount: 2 }
    ];
    const asc = core.sortResults(rows, "nonNullCount", "asc").map((r) => r.nonNullCount);
    const desc = core.sortResults(rows, "nonNullCount", "desc").map((r) => r.nonNullCount);
    assert.deepEqual(asc, [1, 2, 3]);
    assert.deepEqual(desc, [3, 2, 1]);
});

test("findDeprecationCandidates returns fields below the threshold, least-populated first", () => {
    const results = [
        { fieldLabel: "A", nonNullPercentage: 0.02 },
        { fieldLabel: "B", nonNullPercentage: 0.5 },
        { fieldLabel: "C", nonNullPercentage: 0.049 },
        { fieldLabel: "D", nonNullPercentage: 0.05 } // exactly 5% is NOT below 5%
    ];
    const candidates = core.findDeprecationCandidates(results, 5);
    assert.deepEqual(candidates.map((r) => r.fieldLabel), ["A", "C"]);
});

test("findDeprecationCandidates excludes non-numeric percentages and respects a custom threshold", () => {
    const results = [
        { fieldLabel: "A", nonNullPercentage: 0.2 },
        { fieldLabel: "B", nonNullPercentage: null },
        { fieldLabel: "C", nonNullPercentage: 0.6 }
    ];
    assert.deepEqual(core.findDeprecationCandidates(results, 50).map((r) => r.fieldLabel), ["A"]);
});

test("findDeprecationCandidates tolerates empty/invalid input", () => {
    assert.deepEqual(core.findDeprecationCandidates(null, 5), []);
    assert.deepEqual(core.findDeprecationCandidates([], 5), []);
});

test("sortResults sorts strings case-insensitively via localeCompare", () => {
    const rows = [{ fieldLabel: "banana" }, { fieldLabel: "Apple" }, { fieldLabel: "cherry" }];
    const asc = core.sortResults(rows, "field", "asc").map((r) => r.fieldLabel);
    assert.deepEqual(asc, ["Apple", "banana", "cherry"]);
});

test("sortResults places nulls last ascending, first descending (current behavior)", () => {
    // Known quirk: the null comparator flips with sort direction, so null rows
    // sink to the bottom ascending but rise to the top descending. This test
    // pins that behavior so a future "nulls always last" fix is a deliberate,
    // visible change rather than an accidental one.
    const rows = [
        { fieldLabel: "A", nonNullCount: 5 },
        { fieldLabel: "B", nonNullCount: null },
        { fieldLabel: "C", nonNullCount: 1 }
    ];
    const ascNulls = core.sortResults(rows, "nonNullCount", "asc");
    const descNulls = core.sortResults(rows, "nonNullCount", "desc");
    assert.equal(ascNulls[ascNulls.length - 1].nonNullCount, null, "null is last ascending");
    assert.equal(descNulls[0].nonNullCount, null, "null is first descending");
});

test("sortResults does not mutate the input array", () => {
    const rows = [{ nonNullCount: 2 }, { nonNullCount: 1 }];
    const copy = rows.slice();
    core.sortResults(rows, "nonNullCount", "asc");
    assert.deepEqual(rows, copy);
});

test("sortResults returns a copy when no key is given", () => {
    const rows = [{ nonNullCount: 2 }, { nonNullCount: 1 }];
    const out = core.sortResults(rows, null, "asc");
    assert.deepEqual(out, rows);
    assert.notEqual(out, rows);
});

test("formatTimelinePeriod renders a localized month+year", () => {
    // Pin the locale so the assertion is deterministic across environments.
    assert.equal(core.formatTimelinePeriod(2025, 1, "en-US"), "Jan 2025");
    assert.equal(core.formatTimelinePeriod(2024, 12, "en-US"), "Dec 2024");
});

test("formatTimelinePeriod returns em dash for missing parts", () => {
    assert.equal(core.formatTimelinePeriod(0, 5, "en-US"), "—");
    assert.equal(core.formatTimelinePeriod(2025, 0, "en-US"), "—");
});

test("getTimelinePeriods dedupes and sorts chronologically", () => {
    const rows = [
        { year: 2025, month: 2, value: "A", count: 1 },
        { year: 2024, month: 12, value: "B", count: 2 },
        { year: 2025, month: 2, value: "B", count: 3 },
        { year: 2025, month: 1, value: "A", count: 4 }
    ];
    const periods = core.getTimelinePeriods(rows, "en-US");
    assert.deepEqual(periods.map((p) => p.key), ["2024-12", "2025-1", "2025-2"]);
    assert.equal(periods[0].yearLabel, "2024");
    assert.equal(periods[0].monthLabel, "Dec");
});

test("getTimelinePeriods ignores rows without year/month", () => {
    const rows = [{ year: 2025, month: 3, value: "A", count: 1 }, { value: "B", count: 2 }, null];
    const periods = core.getTimelinePeriods(rows, "en-US");
    assert.equal(periods.length, 1);
});

test("getTimelineValues returns distinct value labels in first-seen order", () => {
    const rows = [
        { value: "Won" },
        { value: "Lost" },
        { value: "Won" },
        { value: null }
    ];
    assert.deepEqual(core.getTimelineValues(rows), ["Won", "Lost", "NULL"]);
});

test("buildTimelineGroupMap sums counts per period and value", () => {
    const rows = [
        { year: 2025, month: 1, value: "Won", count: 2 },
        { year: 2025, month: 1, value: "Won", count: 3 },
        { year: 2025, month: 1, value: "Lost", count: 1 },
        { year: 2025, month: 2, value: "Won", count: 4 }
    ];
    const map = core.buildTimelineGroupMap(rows);
    assert.deepEqual(map.get("2025-1"), { Won: 5, Lost: 1 });
    assert.deepEqual(map.get("2025-2"), { Won: 4 });
});

test("getTimelineColor cycles through the palette", () => {
    const first = core.getTimelineColor(0);
    assert.equal(typeof first, "string");
    assert.equal(core.getTimelineColor(10), first, "index 10 wraps to index 0");
    assert.notEqual(core.getTimelineColor(1), first);
});
