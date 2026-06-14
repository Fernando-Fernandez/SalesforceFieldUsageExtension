// Shared, dependency-free helpers used by the report (and, later, the popup).
// These functions touch no DOM, no chrome.* APIs, and no network, so they can be
// unit-tested under Node with node:test while still loading in the browser as a
// plain <script> that attaches the API to the global object.
//
// UMD-style export: assigns to globalThis.SFUsageCore for the extension pages and
// to module.exports for the test runner.
(function (global) {
    "use strict";

    function chunkArray(array, size) {
        const result = [];
        if (!Array.isArray(array) || !(size > 0)) {
            return result;
        }
        for (let i = 0; i < array.length; i += size) {
            result.push(array.slice(i, i + size));
        }
        return result;
    }

    function formatNumber(value) {
        if (value === null || value === undefined) {
            return "—";
        }
        const numericValue = typeof value === "number" ? value : Number(value);
        if (Number.isNaN(numericValue)) {
            return "—";
        }
        return numericValue.toLocaleString();
    }

    function formatPercentage(value) {
        if (value === null || value === undefined) {
            return "—";
        }
        const numericValue = typeof value === "number" ? value : Number(value);
        if (Number.isNaN(numericValue)) {
            return "—";
        }
        return `${(numericValue * 100).toFixed(2)}%`;
    }

    function normalizePercentage(value) {
        const numericValue = typeof value === "number" ? value : Number(value);
        if (Number.isNaN(numericValue) || !Number.isFinite(numericValue)) {
            return 0;
        }
        return Math.min(Math.max(numericValue, 0), 1);
    }

    function formatDistributionValue(value) {
        if (value === null || value === undefined) {
            return "NULL";
        }
        if (typeof value === "object") {
            if (value.displayValue) {
                return value.displayValue;
            }
            if (value.value) {
                return value.value;
            }
            return JSON.stringify(value);
        }
        return value.toString();
    }

    function getSortValue(result, key) {
        switch (key) {
            case "sobject":
                return result.sobjectLabel;
            case "field":
                return result.fieldLabel;
            case "sobjectCount":
                return result.sobjectCount;
            case "nonNullCount":
                return result.nonNullCount;
            case "nonNullPercentage":
                return result.nonNullPercentage;
            case "status":
                return result.status;
            default:
                return null;
        }
    }

    function sortResults(results, key, direction) {
        if (!Array.isArray(results)) {
            return [];
        }
        if (!key) {
            return results.slice();
        }
        const multiplier = direction === "desc" ? -1 : 1;
        return results.slice().sort((a, b) => {
            const aValue = getSortValue(a, key);
            const bValue = getSortValue(b, key);
            if (aValue == null && bValue == null) {
                return 0;
            }
            if (aValue == null) {
                return 1 * multiplier;
            }
            if (bValue == null) {
                return -1 * multiplier;
            }
            if (typeof aValue === "number" && typeof bValue === "number") {
                return (aValue - bValue) * multiplier;
            }
            return aValue.toString().localeCompare(bValue.toString()) * multiplier;
        });
    }

    function formatTimelinePeriod(year, month, locale) {
        if (!year || !month) {
            return "—";
        }
        const date = new Date(year, month - 1, 1);
        return date.toLocaleString(locale, { month: "short", year: "numeric" });
    }

    function getTimelinePeriods(rows, locale) {
        const map = new Map();
        (rows || []).forEach((row) => {
            if (!row || !row.year || !row.month) {
                return;
            }
            const key = `${row.year}-${row.month}`;
            if (!map.has(key)) {
                const date = new Date(row.year, row.month - 1, 1);
                map.set(key, {
                    key,
                    sortValue: row.year * 100 + row.month,
                    label: formatTimelinePeriod(row.year, row.month, locale),
                    monthLabel: date.toLocaleString(locale, { month: "short" }),
                    yearLabel: date.getFullYear().toString()
                });
            }
        });
        return Array.from(map.values()).sort((a, b) => a.sortValue - b.sortValue);
    }

    function getTimelineValues(rows) {
        const seen = new Map();
        (rows || []).forEach((row) => {
            const label = formatDistributionValue(row.value);
            if (!seen.has(label)) {
                seen.set(label, label);
            }
        });
        return Array.from(seen.keys());
    }

    function buildTimelineGroupMap(rows) {
        const groupMap = new Map();
        (rows || []).forEach((row) => {
            if (!row || !row.year || !row.month) {
                return;
            }
            const key = `${row.year}-${row.month}`;
            if (!groupMap.has(key)) {
                groupMap.set(key, {});
            }
            const group = groupMap.get(key);
            const label = formatDistributionValue(row.value);
            group[label] = (group[label] || 0) + (row.count || 0);
        });
        return groupMap;
    }

    // Strips a single leading dot from a cookie domain (".my.salesforce.com").
    // Throws when the domain is missing so callers surface a clear connection error.
    function sanitizeDomain(domain) {
        if (!domain) {
            throw new Error("Salesforce domain not returned by background script.");
        }
        return domain.startsWith(".") ? domain.substring(1) : domain;
    }

    function buildFieldKey(sobject, field) {
        return `${sobject}:${field}`;
    }

    function parseFieldKey(value) {
        if (!value || value.indexOf(":") === -1) {
            return null;
        }
        const [sobject, field] = value.split(":");
        if (!sobject || !field) {
            return null;
        }
        return { sobject, field };
    }

    // textarea/address fields cannot be used as SOQL filter criteria, so they are
    // skipped by the usage/timeline queries. Unknown/typeless fields are allowed.
    function isFilterableField(fieldMeta) {
        if (!fieldMeta || !fieldMeta.type) {
            return true;
        }
        const type = fieldMeta.type.toLowerCase();
        return type !== "textarea" && type !== "address";
    }

    function buildExplainUrl(sobject, field, apiVersion) {
        const query = `SELECT count(Id) FROM ${sobject} WHERE ${field} != null`;
        return `/services/data/${apiVersion}/tooling/query/?explain=${encodeURIComponent(query)}`;
    }

    // Turns a Tooling API query-plan response into estimated non-null counts.
    // Returns null when the optimizer did not supply cardinality data.
    function parsePlanFromResponse(body) {
        if (!body || !Array.isArray(body.plans) || body.plans.length === 0) {
            return null;
        }
        const plan = body.plans[0];
        const cardinality = typeof plan.cardinality === "number" ? plan.cardinality : null;
        const sobjectCardinality =
            typeof plan.sobjectCardinality === "number" ? plan.sobjectCardinality : null;

        if (cardinality === null || sobjectCardinality === null) {
            return null;
        }

        return {
            nonNullCount: cardinality,
            sobjectCount: sobjectCardinality,
            nonNullPercentage: sobjectCardinality === 0 ? 0 : cardinality / sobjectCardinality
        };
    }

    function extractCompositeError(body) {
        if (!body) {
            return "Unknown error.";
        }
        if (Array.isArray(body) && body.length > 0) {
            return body[0].message || JSON.stringify(body[0]);
        }
        if (body.message) {
            return body.message;
        }
        return JSON.stringify(body);
    }

    // Salesforce returns HTTP 401 (INVALID_SESSION_ID) when a session has expired.
    // 403 is intentionally excluded: it usually signals a real permission/IP issue
    // that refreshing the session would not fix and could retry-loop on.
    function isAuthFailureStatus(status) {
        return status === 401;
    }

    // Picks the newest API version from the GET /services/data/ payload (an array
    // of { label, url, version } entries). Compares numerically so it does not rely
    // on the array's ordering, and returns the "v<n>.0" form used to build URLs.
    function pickLatestApiVersion(versions, fallback) {
        if (!Array.isArray(versions) || !versions.length) {
            return fallback;
        }
        let best = null;
        let bestNum = -Infinity;
        versions.forEach((entry) => {
            const num = parseFloat(entry && entry.version);
            if (Number.isFinite(num) && num > bestNum) {
                bestNum = num;
                best = entry;
            }
        });
        return best ? `v${best.version}` : fallback;
    }

    // Reads the count for a specific object out of a /limits/recordCount response
    // ({ sObjects: [ { name, count } ] }). Returns null when the object is absent
    // or has no numeric count, signalling callers to fall back to SELECT COUNT().
    function extractRecordCount(response, sobject) {
        const list = response && Array.isArray(response.sObjects) ? response.sObjects : null;
        if (!list) {
            return null;
        }
        const entry = list.find((item) => item && item.name === sobject);
        return entry && typeof entry.count === "number" ? entry.count : null;
    }

    // --- field dependency ("where is this field used?") helpers ------------

    // Derives a custom field's Tooling DeveloperName from its API name: drops the
    // trailing "__c" and any leading "namespace__" prefix. Returns null for names
    // without a "__c" suffix (standard fields), which have no CustomField record.
    function customFieldDeveloperName(apiName) {
        if (typeof apiName !== "string" || !/__c$/i.test(apiName)) {
            return null;
        }
        const withoutSuffix = apiName.replace(/__c$/i, "");
        // A managed field is "namespace__Name"; the DeveloperName is the part after
        // the last remaining "__" separator. A non-namespaced field has none.
        const separator = withoutSuffix.lastIndexOf("__");
        const developerName = separator === -1 ? withoutSuffix : withoutSuffix.slice(separator + 2);
        return developerName || null;
    }

    // Escapes single quotes so a value can be embedded in a SOQL string literal.
    function escapeSoqlLiteral(value) {
        return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    }

    // SOQL to resolve a custom field to its Tooling CustomField Id. Uses the
    // EntityDefinition relationship so it works for standard and custom objects
    // without resolving TableEnumOrId.
    function buildCustomFieldIdQuery(object, developerName) {
        return (
            "SELECT Id FROM CustomField WHERE EntityDefinition.QualifiedApiName = '" +
            escapeSoqlLiteral(object) +
            "' AND DeveloperName = '" +
            escapeSoqlLiteral(developerName) +
            "' LIMIT 1"
        );
    }

    // SOQL to list the metadata components that reference a given component id.
    function buildDependencyQuery(id) {
        return (
            "SELECT MetadataComponentName, MetadataComponentType FROM " +
            "MetadataComponentDependency WHERE RefMetadataComponentId = '" +
            escapeSoqlLiteral(id) +
            "'"
        );
    }

    // Pulls the first record's Id out of a Tooling query response, or null.
    function extractFirstId(response) {
        const records = response && Array.isArray(response.records) ? response.records : null;
        return records && records[0] && records[0].Id ? records[0].Id : null;
    }

    // Groups MetadataComponentDependency rows by component type into
    // [{ type, count, names }], sorted by type, with de-duplicated sorted names.
    function groupDependencies(rows) {
        const byType = new Map();
        (rows || []).forEach((row) => {
            if (!row) {
                return;
            }
            const type = row.MetadataComponentType || "Unknown";
            const name = row.MetadataComponentName || "(unnamed)";
            if (!byType.has(type)) {
                byType.set(type, new Set());
            }
            byType.get(type).add(name);
        });
        return Array.from(byType.entries())
            .map(([type, names]) => ({
                type,
                count: names.size,
                names: Array.from(names).sort((a, b) => a.localeCompare(b))
            }))
            .sort((a, b) => a.type.localeCompare(b.type));
    }

    // Adds a per-period percentage to grouped timeline rows (each value's share of
    // its own month) and drops empty rows.
    function normalizeTimelineRows(rows = []) {
        if (!rows || !rows.length) {
            return [];
        }
        const totals = new Map();
        rows.forEach((row) => {
            const key = `${row.year}-${row.month}`;
            totals.set(key, (totals.get(key) || 0) + (row.count || 0));
        });
        return rows
            .map((row) => {
                const key = `${row.year}-${row.month}`;
                const total = totals.get(key) || 0;
                return {
                    year: row.year,
                    month: row.month,
                    value: row.value ?? null,
                    count: row.count || 0,
                    percentage: total ? (row.count || 0) / total : 0
                };
            })
            .filter((row) => row.count > 0);
    }

    // --- background service worker helpers ---------------------------------

    // A Salesforce "sid" cookie value is "<orgId>!<sessionToken>". Returns the
    // org id, or null when the value is missing/empty so callers refuse to match
    // a session rather than fall back to a too-permissive prefix.
    function parseOrgIdFromCookie(cookieValue) {
        if (typeof cookieValue !== "string" || cookieValue.length === 0) {
            return null;
        }
        const orgId = cookieValue.split("!")[0];
        return orgId || null;
    }

    // Finds the secure session cookie belonging to a specific org (several orgs
    // may have live cookies). Returns null on a falsy org id to avoid matching an
    // unrelated cookie via an empty prefix.
    function findSessionCookieForOrg(cookies, orgId) {
        if (!Array.isArray(cookies) || !orgId) {
            return null;
        }
        return (
            cookies.find(
                (cookie) =>
                    cookie &&
                    typeof cookie.value === "string" &&
                    cookie.value.startsWith(`${orgId}!`)
            ) || null
        );
    }

    // Flattens the in-memory tab→session Map into a plain array for chrome.storage,
    // dropping any incomplete entries.
    function serializeTabSessions(tabSessionMap) {
        if (!tabSessionMap || typeof tabSessionMap.entries !== "function") {
            return [];
        }
        return Array.from(tabSessionMap.entries())
            .filter(([tabUrl, info]) => tabUrl && info && info.domain && info.session)
            .map(([tabUrl, info]) => ({ tabUrl, domain: info.domain, session: info.session }));
    }

    // Keeps the report cache bounded: retains the `maxEntries` most recently
    // generated reports (by generatedAt) and drops the rest. Returns a new object
    // so the caller can persist it directly.
    function pruneReportStore(store, maxEntries) {
        const entries = Object.entries(store || {});
        if (!(maxEntries > 0)) {
            return {};
        }
        if (entries.length <= maxEntries) {
            return Object.fromEntries(entries);
        }
        entries.sort((a, b) => (b[1]?.generatedAt || 0) - (a[1]?.generatedAt || 0));
        return Object.fromEntries(entries.slice(0, maxEntries));
    }

    // Inverse of serializeTabSessions: validates stored entries before they are
    // trusted back into the cache.
    function deserializeTabSessions(entries) {
        if (!Array.isArray(entries)) {
            return [];
        }
        return entries
            .filter((entry) => entry && entry.tabUrl && entry.domain && entry.session)
            .map((entry) => ({
                tabUrl: entry.tabUrl,
                domain: entry.domain,
                session: entry.session
            }));
    }

    function getTimelineColor(index) {
        const palette = [
            "#4c9ffe",
            "#ff9f43",
            "#2ecc71",
            "#e74c3c",
            "#9b59b6",
            "#16a085",
            "#f1c40f",
            "#e67e22",
            "#1abc9c",
            "#2e86de"
        ];
        return palette[index % palette.length];
    }

    const api = {
        chunkArray,
        formatNumber,
        formatPercentage,
        normalizePercentage,
        formatDistributionValue,
        getSortValue,
        sortResults,
        formatTimelinePeriod,
        getTimelinePeriods,
        getTimelineValues,
        buildTimelineGroupMap,
        getTimelineColor,
        sanitizeDomain,
        buildFieldKey,
        parseFieldKey,
        isFilterableField,
        buildExplainUrl,
        parsePlanFromResponse,
        extractCompositeError,
        isAuthFailureStatus,
        pickLatestApiVersion,
        extractRecordCount,
        customFieldDeveloperName,
        buildCustomFieldIdQuery,
        buildDependencyQuery,
        extractFirstId,
        groupDependencies,
        normalizeTimelineRows,
        parseOrgIdFromCookie,
        findSessionCookieForOrg,
        serializeTabSessions,
        deserializeTabSessions,
        pruneReportStore
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.SFUsageCore = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
