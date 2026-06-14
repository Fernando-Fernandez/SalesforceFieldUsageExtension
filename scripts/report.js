(function () {
    const GET_REPORT_DATA = "getReportData";
    const GET_HOST_SESSION = "getHostSession";

    // Pure data-transform helpers live in scripts/lib/usage-core.js (loaded before
    // this script and unit-tested under node:test). Pull them in as locals so the
    // rest of this file reads unchanged.
    const {
        chunkArray,
        toCsv,
        formatNumber,
        formatPercentage,
        normalizePercentage,
        formatDistributionValue,
        sortResults,
        formatTimelinePeriod,
        getTimelinePeriods,
        getTimelineValues,
        buildTimelineGroupMap,
        getTimelineColor,
        sanitizeDomain,
        isAuthFailureStatus,
        parseCustomFieldName,
        buildCustomFieldIdQuery,
        buildDependencyQuery,
        extractFirstId,
        groupDependencies
    } = globalThis.SFUsageCore;

    const statusEl = document.getElementById("reportStatus");
    const tableSectionEl = document.getElementById("reportTableSection");
    const tableBodyEl = document.getElementById("reportTableBody");
    const metaEl = document.getElementById("reportMeta");
    const tableHeaders = Array.from(document.querySelectorAll("th[data-sort-key]"));
    const chartSectionEl = document.getElementById("chartSection");
    const chartContainerEl = document.getElementById("fieldChartContainer");
    const distributionSectionEl = document.getElementById("distributionSection");
    const distributionContainerEl = document.getElementById("distributionTables");
    const summaryTimelineSectionEl = document.getElementById("summaryTimelineSection");
    const summaryTimelineContainerEl = document.getElementById("summaryTimelineCards");
    const downloadCsvBtn = document.getElementById("downloadCsvBtn");

    const state = {
        results: [],
        summaryTimeline: [],
        mode: "summary",
        sortKey: null,
        sortDirection: "asc",
        // Connection info for on-demand dependency lookups. The session token is
        // fetched lazily from the background worker and kept only in memory.
        host: null,
        apiVersion: null,
        session: null
    };

    document.addEventListener("DOMContentLoaded", init);
    tableHeaders.forEach((header) => header.addEventListener("click", handleSort));

    async function init() {
        const params = new URLSearchParams(location.search);
        const reportId = params.get("reportId");
        if (!reportId) {
            setStatus("Missing report identifier.", "error");
            return;
        }

        try {
            const reportData = await requestReportData(reportId);
            if (!reportData || !Array.isArray(reportData.results) || !reportData.results.length) {
                setStatus("No data available for this report.", "error");
                return;
            }
            state.results = reportData.results;
            state.summaryTimeline = Array.isArray(reportData.summaryTimeline) ? reportData.summaryTimeline : [];
            state.host = reportData.host || null;
            state.apiVersion = reportData.apiVersion || null;
            renderMeta(reportData.generatedAt);

            const hasDistribution = state.results.some((result) => Array.isArray(result.rows));
            if (hasDistribution) {
                state.mode = "distribution";
                renderDistributionTables(state.results);
                if (chartSectionEl) {
                    chartSectionEl.hidden = true;
                }
                if (summaryTimelineSectionEl) {
                    summaryTimelineSectionEl.hidden = true;
                }
                if (summaryTimelineContainerEl) {
                    summaryTimelineContainerEl.innerHTML = "";
                }
                tableSectionEl.hidden = true;
                clearStatus();
                enableCsvDownload();
                return;
            }

            state.mode = "summary";
            if (distributionSectionEl) {
                distributionSectionEl.hidden = true;
            }
            if (distributionContainerEl) {
                distributionContainerEl.innerHTML = "";
            }
            renderTable(state.results);
            renderBarChart(state.results);
            renderSummaryTimelines(state.summaryTimeline);
            clearStatus();
            tableSectionEl.hidden = false;
            enableCsvDownload();
        } catch (error) {
            console.error("Unable to load report", error);
            setStatus(error.message || "Unable to load report.", "error");
        }
    }

    function enableCsvDownload() {
        if (!downloadCsvBtn) {
            return;
        }
        downloadCsvBtn.hidden = false;
        downloadCsvBtn.onclick = () => {
            const { csv, filename } = buildCsv();
            downloadCsv(filename, csv);
        };
    }

    // Builds the CSV for the current report mode: flattened value rows for the
    // distribution report, or the field-summary table for the summary report.
    function buildCsv() {
        const stamp = new Date().toISOString().slice(0, 10);
        if (state.mode === "distribution") {
            const headers = ["SObject", "Field", "Value", "Value Count", "Percent"];
            const rows = [];
            state.results.forEach((result) => {
                const distributionRows = Array.isArray(result.rows) ? result.rows : [];
                if (!distributionRows.length) {
                    rows.push([result.sobjectLabel || result.sobject, result.fieldLabel || result.field, "", "", ""]);
                    return;
                }
                distributionRows.forEach((row) => {
                    rows.push([
                        result.sobjectLabel || result.sobject,
                        result.fieldLabel || result.field,
                        formatDistributionValue(row.value),
                        row.count,
                        csvPercent(row.percentage)
                    ]);
                });
            });
            return { csv: toCsv(headers, rows), filename: `field-usage-distribution-${stamp}.csv` };
        }
        const headers = [
            "SObject",
            "Field",
            "SObject Count",
            "Estimated Non-Null Count",
            "Estimated Percent Non-Null"
        ];
        const rows = state.results.map((result) => [
            result.sobjectLabel || result.sobject,
            result.fieldLabel || result.field,
            result.sobjectCount,
            result.nonNullCount,
            csvPercent(result.nonNullPercentage)
        ]);
        return { csv: toCsv(headers, rows), filename: `field-usage-summary-${stamp}.csv` };
    }

    // Renders a 0..1 ratio as a plain numeric percent (e.g. 0.75 -> "75.00") so the
    // CSV stays analysis-friendly in a spreadsheet; blank for non-numeric.
    function csvPercent(value) {
        const numeric = typeof value === "number" ? value : Number(value);
        return Number.isFinite(numeric) ? (numeric * 100).toFixed(2) : "";
    }

    function downloadCsv(filename, csv) {
        // Prepend a UTF-8 BOM so Excel reads non-ASCII values correctly.
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    function requestReportData(reportId) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { type: GET_REPORT_DATA, reportId },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (!response || !response.success || !response.data) {
                        reject(new Error(response?.error || "Report data not found."));
                        return;
                    }
                    resolve(response.data);
                }
            );
        });
    }

    // --- on-demand field dependency lookup ---------------------------------

    const DEFAULT_API_VERSION = "v60.0";

    // Requests the session for the report's org from the background worker (same
    // path the popup uses) and caches it in memory only.
    function getReportSession() {
        if (state.session) {
            return Promise.resolve(state.session);
        }
        if (!state.host) {
            return Promise.reject(new Error("Connection info unavailable. Reopen the report from the popup."));
        }
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { message: GET_HOST_SESSION, url: `https://${state.host}/` },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (!response || !response.session) {
                        reject(new Error("Unable to read Salesforce session. Verify you are logged in."));
                        return;
                    }
                    state.session = response.session;
                    state.host = sanitizeDomain(response.domain) || state.host;
                    resolve(state.session);
                }
            );
        });
    }

    // Low-level GET against an absolute Tooling path (a /services/data/... URL or
    // a nextRecordsUrl), with a single 401-triggered session refresh.
    async function toolingFetch(path, allowRetry = true) {
        const session = await getReportSession();
        const response = await fetch(`https://${state.host}${path}`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${session}`
            }
        });
        if (isAuthFailureStatus(response.status) && allowRetry) {
            state.session = null; // force a fresh session, then retry once
            return toolingFetch(path, false);
        }
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Salesforce API error (${response.status}): ${text}`);
        }
        return response.json();
    }

    function toolingQuery(soql) {
        const version = state.apiVersion || DEFAULT_API_VERSION;
        return toolingFetch(`/services/data/${version}/tooling/query/?q=${encodeURIComponent(soql)}`);
    }

    // Runs a Tooling query and follows nextRecordsUrl to completion, returning all
    // records. The query API pages at ~2000 rows; without this a heavily-referenced
    // field would silently drop dependencies beyond the first page.
    async function toolingQueryAllRecords(soql) {
        let page = await toolingQuery(soql);
        const records = Array.isArray(page.records) ? page.records.slice() : [];
        while (!page.done && page.nextRecordsUrl) {
            page = await toolingFetch(page.nextRecordsUrl);
            if (Array.isArray(page.records)) {
                records.push(...page.records);
            }
        }
        return records;
    }

    // Resolves the field to its CustomField id, then lists the metadata that
    // references it. Returns { dependencies, message } where a message describes
    // why the list is empty (standard field, not found, or no references).
    async function fetchFieldDependencies(result) {
        const parsed = parseCustomFieldName(result.field);
        if (!parsed) {
            return { dependencies: [], message: "Dependency analysis is available for custom fields only." };
        }
        const idResponse = await toolingQuery(
            buildCustomFieldIdQuery(result.sobject, parsed.developerName, parsed.namespace)
        );
        const fieldId = extractFirstId(idResponse);
        if (!fieldId) {
            return { dependencies: [], message: "This field was not found in the org's custom field metadata." };
        }
        const depRecords = await toolingQueryAllRecords(buildDependencyQuery(fieldId));
        const dependencies = groupDependencies(depRecords);
        if (!dependencies.length) {
            return {
                dependencies: [],
                message: "Not referenced by any tracked metadata. (The Dependency API is Beta and may miss some references.)"
            };
        }
        return { dependencies, message: "" };
    }

    function renderMeta(timestamp) {
        if (!metaEl) {
            return;
        }
        if (!timestamp) {
            metaEl.textContent = "";
            return;
        }
        const date = new Date(timestamp);
        metaEl.textContent = `Generated on ${date.toLocaleString()}`;
    }

    function renderTable(results) {
        if (!Array.isArray(results)) {
            return;
        }
        tableBodyEl.innerHTML = "";
        results.forEach((result) => {
            const row = document.createElement("tr");
            row.appendChild(createCell(result.sobjectLabel));
            row.appendChild(createSummaryFieldCell(result));
            row.appendChild(createCell(formatNumber(result.sobjectCount)));
            row.appendChild(createCell(formatNumber(result.nonNullCount)));
            row.appendChild(createCell(formatPercentage(result.nonNullPercentage)));
            row.appendChild(createCell(result.status));
            tableBodyEl.appendChild(row);
        });
    }

    function createCell(text) {
        const cell = document.createElement("td");
        cell.textContent = text ?? "—";
        return cell;
    }

    // Field cell for the summary table: the field name as plain text plus, for a
    // custom field (with connection info available), a small button that loads its
    // metadata dependencies inline. The fetched result is cached on the result
    // object so it survives re-sorts.
    function createSummaryFieldCell(result) {
        const cell = document.createElement("td");

        const name = document.createElement("div");
        name.className = "summary-field-name";
        name.textContent = result.fieldLabel ?? result.field ?? "—";
        cell.appendChild(name);

        if (!state.host || !parseCustomFieldName(result.field)) {
            return cell;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "summary-dependencies__button";
        button.textContent = "Where is this field used?";

        const output = document.createElement("div");
        output.className = "summary-dependencies__output";

        if (result.dependencyResult) {
            renderSummaryDependencies(output, result.dependencyResult);
            button.hidden = true;
        }

        button.addEventListener("click", async () => {
            button.disabled = true;
            appendDependencyNote(output, "Looking up references…", true);
            try {
                const res = await fetchFieldDependencies(result);
                result.dependencyResult = res;
                renderSummaryDependencies(output, res);
                button.hidden = true;
            } catch (error) {
                output.innerHTML = "";
                appendDependencyNote(output, `Dependency analysis unavailable: ${error.message || error}`);
                button.disabled = false;
            }
        });

        cell.appendChild(button);
        cell.appendChild(output);
        return cell;
    }

    function renderSummaryDependencies(output, res) {
        output.innerHTML = "";
        if (res.message) {
            appendDependencyNote(output, res.message);
        } else {
            output.appendChild(buildDependencyList(res.dependencies));
        }
    }

    function setStatus(message, type) {
        if (!statusEl) {
            return;
        }
        statusEl.hidden = false;
        statusEl.textContent = message;
        statusEl.className = `status status-${type}`;
    }

    function clearStatus() {
        if (!statusEl) {
            return;
        }
        statusEl.textContent = "";
        statusEl.className = "status";
        statusEl.hidden = true;
    }

    function handleSort(event) {
        const header = event.currentTarget;
        const key = header.dataset.sortKey;
        if (!key) {
            return;
        }
        if (state.sortKey === key) {
            state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
        } else {
            state.sortKey = key;
            state.sortDirection = "asc";
        }
        applySortState();
        const sortedResults = sortResults(state.results, state.sortKey, state.sortDirection);
        renderTable(sortedResults);
    }

    function applySortState() {
        tableHeaders.forEach((header) => {
            if (header.dataset.sortKey === state.sortKey) {
                header.dataset.sortDirection = state.sortDirection;
            } else {
                header.removeAttribute("data-sort-direction");
            }
        });
    }

    function renderBarChart(results) {
        if (!chartSectionEl || !chartContainerEl || state.mode === "distribution") {
            if (chartSectionEl) {
                chartSectionEl.hidden = true;
            }
            return;
        }
        const data = results
            .map((result) => ({
                label: result.fieldLabel || result.field || "Field",
                value: typeof result.nonNullPercentage === "number"
                    ? result.nonNullPercentage
                    : Number(result.nonNullPercentage)
            }))
            .filter((item) => typeof item.value === "number" && !Number.isNaN(item.value));

        if (!data.length) {
            chartSectionEl.hidden = true;
            chartContainerEl.innerHTML = "";
            return;
        }

        chartSectionEl.hidden = false;
        chartContainerEl.innerHTML = "";

        const groups = chunkArray(data, 50);
        groups.forEach((group, index) => {
            const chartWrapper = document.createElement("div");
            chartWrapper.setAttribute("class", "chart-wrapper");

            if (groups.length > 1) {
                const label = document.createElement("p");
                label.textContent = `Fields ${index * 50 + 1}-${index * 50 + group.length}`;
                label.style.fontWeight = "600";
                chartWrapper.appendChild(label);
            }

            chartWrapper.appendChild(buildChartSvg(group));
            chartContainerEl.appendChild(chartWrapper);
        });
    }

    function buildChartSvg(data) {
        const containerWidth = chartContainerEl.clientWidth || chartSectionEl.clientWidth || 1000;
        const width = Math.max(containerWidth, 600);
        const height = 320;
        const padding = { top: 30, right: 30, bottom: 110, left: 60 };
        const plotWidth = width - padding.left - padding.right;
        const plotHeight = height - padding.top - padding.bottom;
        const maxValue = Math.max(...data.map((d) => d.value), 0);
        const barSpacing = plotWidth / data.length;
        const barWidth = Math.max(20, barSpacing * 0.5);

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", height);
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

        const axes = document.createElementNS(svg.namespaceURI, "path");
        axes.setAttribute(
            "d",
            `M${padding.left},${padding.top} V${padding.top + plotHeight} H${padding.left + plotWidth}`
        );
        axes.setAttribute("stroke", "#d0d7e5");
        axes.setAttribute("fill", "none");
        svg.appendChild(axes);

        data.forEach((item, index) => {
            const barHeight = maxValue === 0 ? 0 : (item.value / maxValue) * plotHeight;
            const x = padding.left + index * barSpacing + (barSpacing - barWidth) / 2;
            const y = padding.top + plotHeight - barHeight;

            const rect = document.createElementNS(svg.namespaceURI, "rect");
            rect.setAttribute("x", x);
            rect.setAttribute("y", y);
            rect.setAttribute("width", barWidth);
            rect.setAttribute("height", barHeight);
            rect.setAttribute("fill", "#4c9ffe");
            svg.appendChild(rect);

            const labelX = x + barWidth / 2;
            const labelY = y + barHeight / 2;
            const valueLabel = document.createElementNS(svg.namespaceURI, "text");
            valueLabel.textContent = `${(item.value * 100).toFixed(1)}%`;
            valueLabel.setAttribute("x", labelX);
            valueLabel.setAttribute("y", labelY);
            valueLabel.setAttribute("transform", `rotate(-90 ${labelX} ${labelY})`);
            valueLabel.setAttribute("text-anchor", "middle");
            valueLabel.setAttribute("fill", barHeight < 30 ? "#1f1f1f" : "#ffffff");
            valueLabel.setAttribute("font-size", "12");
            svg.appendChild(valueLabel);

            const fieldLabel = document.createElementNS(svg.namespaceURI, "text");
            fieldLabel.textContent = item.label;
            fieldLabel.setAttribute("x", x + barWidth / 2);
            fieldLabel.setAttribute("y", padding.top + plotHeight + 20);
            fieldLabel.setAttribute(
                "transform",
                `rotate(-45 ${x + barWidth / 2} ${padding.top + plotHeight + 20})`
            );
            fieldLabel.setAttribute("text-anchor", "end");
            fieldLabel.setAttribute("fill", "#1f1f1f");
            fieldLabel.setAttribute("font-size", "12");
            svg.appendChild(fieldLabel);
        });

        const minLabel = document.createElementNS(svg.namespaceURI, "text");
        minLabel.textContent = "0%";
        minLabel.setAttribute("x", padding.left);
        minLabel.setAttribute("y", padding.top + plotHeight + 30);
        minLabel.setAttribute("text-anchor", "middle");
        minLabel.setAttribute("fill", "#1f1f1f");
        minLabel.setAttribute("font-size", "12");
        svg.appendChild(minLabel);

        const maxLabel = document.createElementNS(svg.namespaceURI, "text");
        maxLabel.textContent = `${(maxValue * 100).toFixed(1)}%`;
        maxLabel.setAttribute("x", padding.left - 5);
        maxLabel.setAttribute("y", padding.top + 10);
        maxLabel.setAttribute("text-anchor", "end");
        maxLabel.setAttribute("fill", "#1f1f1f");
        maxLabel.setAttribute("font-size", "12");
        svg.appendChild(maxLabel);

        return svg;
    }

    function renderDistributionTables(results) {
        if (!distributionContainerEl) {
            return;
        }
        distributionContainerEl.innerHTML = "";
        if (!results.length) {
            if (distributionSectionEl) {
                distributionSectionEl.hidden = true;
            }
            return;
        }

        if (distributionSectionEl) {
            distributionSectionEl.hidden = false;
        }

        results.forEach((result) => {
            const card = document.createElement("article");
            card.className = "distribution-card";

            const title = document.createElement("h3");
            title.textContent = `${result.sobjectLabel || result.sobject} · ${result.fieldLabel || result.field}`;
            card.appendChild(title);

            const meta = document.createElement("p");
            meta.className = "distribution-card__meta";
            meta.textContent = `Record count: ${formatNumber(result.recordCount)} | Status: ${
                result.status || "Success"
            }`;
            card.appendChild(meta);

            if (result.truncated) {
                const note = document.createElement("p");
                note.className = "distribution-card__note";
                const limit = result.distinctLimit || 100;
                note.textContent =
                    `Showing only the ${limit} most common values. This field has more ` +
                    `distinct values, so lower-frequency values are omitted and the ` +
                    `percentages below do not sum to 100%.`;
                card.appendChild(note);
            }

            const meaningfulRows = Array.isArray(result.rows)
                ? result.rows.filter((row) => Number(row?.count ?? 0) > 0)
                : [];

            const chartEl = buildDistributionChart(meaningfulRows);
            if (chartEl) {
                card.appendChild(chartEl);
            }

            const timelineRows = Array.isArray(result.timeline)
                ? result.timeline.filter((row) => Number(row?.count ?? 0) > 0)
                : [];

            const table = document.createElement("table");
            const thead = document.createElement("thead");
            thead.innerHTML = `
                <tr>
                    <th>SObject</th>
                    <th>Record Count</th>
                    <th>Field</th>
                    <th>Value</th>
                    <th>Value Count</th>
                    <th>Percentage</th>
                </tr>
            `;
            table.appendChild(thead);

            const tbody = document.createElement("tbody");
            if (meaningfulRows.length) {
                meaningfulRows.forEach((row) => {
                    const tr = document.createElement("tr");
                    tr.appendChild(createCell(result.sobjectLabel || result.sobject));
                    tr.appendChild(createCell(formatNumber(result.recordCount)));
                    tr.appendChild(createCell(result.fieldLabel || result.field));
                    tr.appendChild(createCell(formatDistributionValue(row.value)));
                    tr.appendChild(createCell(formatNumber(row.count)));
                    tr.appendChild(createCell(formatPercentage(row.percentage)));
                    tbody.appendChild(tr);
                });
            } else {
                const tr = document.createElement("tr");
                const td = document.createElement("td");
                td.colSpan = 6;
                td.textContent = result.status || "No data returned.";
                tr.appendChild(td);
                tbody.appendChild(tr);
            }
            table.appendChild(tbody);
            card.appendChild(table);

            const timelineEl = buildTimelineSection(timelineRows, result.timelineMessage);
            if (timelineEl) {
                card.appendChild(timelineEl);
            }

            card.appendChild(buildDependencySection(result));

            distributionContainerEl.appendChild(card);
        });
    }

    // Renders the "Field Usage in Metadata" block: a button that, on click, runs
    // the on-demand dependency lookup and reveals where the field is referenced.
    function buildDependencySection(result) {
        const container = document.createElement("div");
        container.className = "distribution-dependencies";

        const title = document.createElement("h4");
        title.textContent = "Field Usage in Metadata";
        container.appendChild(title);

        if (!parseCustomFieldName(result.field)) {
            appendDependencyNote(container, "Dependency analysis is available for custom fields only.");
            return container;
        }
        if (!state.host) {
            appendDependencyNote(container, "Reopen the report from the popup to look up where this field is used.");
            return container;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "distribution-dependencies__button";
        button.textContent = "Where is this field used?";

        const output = document.createElement("div");
        output.className = "distribution-dependencies__output";

        button.addEventListener("click", async () => {
            button.disabled = true;
            appendDependencyNote(output, "Looking up references…", true);
            try {
                const { dependencies, message } = await fetchFieldDependencies(result);
                output.innerHTML = "";
                if (message) {
                    appendDependencyNote(output, message);
                } else {
                    output.appendChild(buildDependencyList(dependencies));
                }
                button.hidden = true;
            } catch (error) {
                output.innerHTML = "";
                appendDependencyNote(output, `Dependency analysis unavailable: ${error.message || error}`);
                button.disabled = false;
            }
        });

        container.appendChild(button);
        container.appendChild(output);
        return container;
    }

    function appendDependencyNote(parent, text, clear) {
        if (clear) {
            parent.innerHTML = "";
        }
        const note = document.createElement("p");
        note.className = "distribution-dependencies__note";
        note.textContent = text;
        parent.appendChild(note);
    }

    function buildDependencyList(groups) {
        const total = groups.reduce((sum, group) => sum + group.count, 0);
        const wrapper = document.createElement("div");

        const summary = document.createElement("p");
        summary.className = "distribution-dependencies__summary";
        summary.textContent = `Referenced by ${total} component${total === 1 ? "" : "s"}:`;
        wrapper.appendChild(summary);

        const list = document.createElement("ul");
        list.className = "distribution-dependencies__list";
        groups.forEach((group) => {
            const item = document.createElement("li");
            const label = document.createElement("strong");
            label.textContent = `${group.type} (${group.count}): `;
            item.appendChild(label);
            item.appendChild(document.createTextNode(group.names.join(", ")));
            list.appendChild(item);
        });
        wrapper.appendChild(list);
        return wrapper;
    }

    function buildDistributionChart(rows) {
        if (!Array.isArray(rows) || !rows.length) {
            return null;
        }
        const chart = document.createElement("div");
        chart.className = "distribution-chart";

        rows.forEach((row) => {
            const percentageValue = normalizePercentage(row?.percentage);
            const rowEl = document.createElement("div");
            rowEl.className = "distribution-chart__row";

            const label = document.createElement("span");
            label.className = "distribution-chart__label";
            label.textContent = formatDistributionValue(row?.value);
            rowEl.appendChild(label);

            const bar = document.createElement("div");
            bar.className = "distribution-chart__bar";
            const fill = document.createElement("span");
            fill.className = "distribution-chart__fill";
            fill.style.width = `${percentageValue * 100}%`;
            bar.appendChild(fill);
            rowEl.appendChild(bar);

            const value = document.createElement("span");
            value.className = "distribution-chart__value";
            value.textContent = formatPercentage(percentageValue);
            rowEl.appendChild(value);

            chart.appendChild(rowEl);
        });

        return chart;
    }

    function renderSummaryTimelines(timelines) {
        if (!summaryTimelineContainerEl) {
            return;
        }
        summaryTimelineContainerEl.innerHTML = "";
        if (!Array.isArray(timelines) || !timelines.length) {
            if (summaryTimelineSectionEl) {
                summaryTimelineSectionEl.hidden = true;
            }
            return;
        }
        if (summaryTimelineSectionEl) {
            summaryTimelineSectionEl.hidden = false;
        }
        timelines.forEach((item) => {
            const card = document.createElement("article");
            card.className = "distribution-card";

            const title = document.createElement("h3");
            title.textContent = item.sobjectLabel || item.sobject;
            card.appendChild(title);

            const timelineEl = buildTimelineSection(item.rows || [], item.timelineMessage);
            if (timelineEl) {
                card.appendChild(timelineEl);
            }
            summaryTimelineContainerEl.appendChild(card);
        });
    }

    function buildTimelineSection(rows, message) {
        const hasRows = Array.isArray(rows) && rows.length > 0;
        if (!hasRows && !message) {
            return null;
        }
        const container = document.createElement("div");
        container.className = "distribution-timeline";

        const title = document.createElement("h4");
        title.textContent = "Monthly Trend (Last 12 Months)";
        container.appendChild(title);

        if (hasRows) {
            const chart = buildTimelineChart(rows);
            if (chart) {
                container.appendChild(chart);
            }

            const table = document.createElement("table");
            const thead = document.createElement("thead");
            thead.innerHTML = `
                <tr>
                    <th>Period</th>
                    <th>Value</th>
                    <th>Value Count</th>
                    <th>Period %</th>
                </tr>
            `;
            table.appendChild(thead);

            const tbody = document.createElement("tbody");
            rows
                .slice()
                .sort((a, b) => {
                    const aKey = (a.year || 0) * 100 + (a.month || 0);
                    const bKey = (b.year || 0) * 100 + (b.month || 0);
                    if (aKey === bKey) {
                        return formatDistributionValue(a.value).localeCompare(formatDistributionValue(b.value));
                    }
                    return aKey - bKey;
                })
                .forEach((row) => {
                    const tr = document.createElement("tr");
                    tr.appendChild(createCell(formatTimelinePeriod(row.year, row.month)));
                    tr.appendChild(createCell(formatDistributionValue(row.value)));
                    tr.appendChild(createCell(formatNumber(row.count)));
                    tr.appendChild(createCell(formatPercentage(row.percentage)));
                    tbody.appendChild(tr);
                });

            table.appendChild(tbody);
            container.appendChild(table);
        }

        if (message && !hasRows) {
            const note = document.createElement("p");
            note.className = "distribution-timeline__empty";
            note.textContent = message;
            container.appendChild(note);
        }

        return container;
    }

    function buildTimelineChart(rows) {
        if (!Array.isArray(rows) || !rows.length) {
            return null;
        }
        const periods = getTimelinePeriods(rows);
        if (!periods.length) {
            return null;
        }
        const values = getTimelineValues(rows);
        const maxCount = Math.max(...rows.map((row) => row.count || 0), 0);
        if (maxCount === 0) {
            return null;
        }

        const groupWidth = values.length * 22 + 12;
        const width = Math.max(periods.length * groupWidth + 60, 320);
        const height = 220;
        const padding = { top: 20, right: 20, bottom: 50, left: 50 };
        const plotWidth = width - padding.left - padding.right;
        const plotHeight = height - padding.top - padding.bottom;
        const logMax = Math.log(maxCount + 1);

        const chartWrapper = document.createElement("div");
        chartWrapper.className = "timeline-chart";

        const legend = document.createElement("div");
        legend.className = "timeline-chart__legend";
        values.forEach((valueLabel, index) => {
            const legendItem = document.createElement("span");
            legendItem.className = "timeline-chart__legend-item";

            const swatch = document.createElement("span");
            swatch.className = "timeline-chart__legend-swatch";
            swatch.style.backgroundColor = getTimelineColor(index);

            legendItem.appendChild(swatch);
            legendItem.appendChild(document.createTextNode(valueLabel));
            legend.appendChild(legendItem);
        });
        chartWrapper.appendChild(legend);

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", height);
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

        const axis = document.createElementNS(svg.namespaceURI, "line");
        axis.setAttribute("x1", padding.left);
        axis.setAttribute("y1", padding.top + plotHeight);
        axis.setAttribute("x2", padding.left + plotWidth);
        axis.setAttribute("y2", padding.top + plotHeight);
        axis.setAttribute("stroke", "#d0d7e5");
        svg.appendChild(axis);

        const axisLabel = document.createElementNS(svg.namespaceURI, "text");
        axisLabel.textContent = "(log scale)";
        axisLabel.setAttribute("x", padding.left - 40);
        axisLabel.setAttribute("y", padding.top + plotHeight / 2);
        axisLabel.setAttribute("transform", `rotate(-90 ${padding.left - 40} ${padding.top + plotHeight / 2})`);
        axisLabel.setAttribute("text-anchor", "middle");
        axisLabel.setAttribute("fill", "#5f6c80");
        axisLabel.setAttribute("font-size", "11");
        svg.appendChild(axisLabel);

        const groupMap = buildTimelineGroupMap(rows);

        periods.forEach((period, periodIndex) => {
            values.forEach((valueLabel, valueIndex) => {
                const count = groupMap.get(period.key)?.[valueLabel] || 0;
                if (!count) {
                    return;
                }
                const barHeight = logMax === 0 ? 0 : (Math.log(count + 1) / logMax) * plotHeight;
                const x =
                    padding.left +
                    periodIndex * groupWidth +
                    valueIndex * 22;
                const y = padding.top + plotHeight - barHeight;
                const rect = document.createElementNS(svg.namespaceURI, "rect");
                rect.setAttribute("x", x);
                rect.setAttribute("y", y);
                rect.setAttribute("width", 18);
                rect.setAttribute("height", Math.max(barHeight, 1));
                rect.setAttribute("fill", getTimelineColor(valueIndex));
                svg.appendChild(rect);

                const label = document.createElementNS(svg.namespaceURI, "text");
                label.textContent = count.toLocaleString();
                label.setAttribute("x", x + 9);
                label.setAttribute("y", Math.max(y - 4, 12));
                label.setAttribute("text-anchor", "middle");
                label.setAttribute("fill", "#1f1f1f");
                label.setAttribute("font-size", "10");
                svg.appendChild(label);
            });

            const periodLabel = document.createElementNS(svg.namespaceURI, "text");
            const labelX = padding.left + periodIndex * groupWidth + (values.length * 22) / 2;
            periodLabel.setAttribute("x", labelX);
            periodLabel.setAttribute("y", padding.top + plotHeight + 20);
            periodLabel.setAttribute("text-anchor", "middle");
            periodLabel.setAttribute("fill", "#2f3c4d");
            periodLabel.setAttribute("font-size", "11");

            const monthSpan = document.createElementNS(svg.namespaceURI, "tspan");
            monthSpan.setAttribute("x", labelX);
            monthSpan.setAttribute("dy", "0");
            monthSpan.textContent = period.monthLabel || period.label;
            periodLabel.appendChild(monthSpan);

            const yearSpan = document.createElementNS(svg.namespaceURI, "tspan");
            yearSpan.setAttribute("x", labelX);
            yearSpan.setAttribute("dy", "12");
            yearSpan.textContent = period.yearLabel || "";
            periodLabel.appendChild(yearSpan);

            svg.appendChild(periodLabel);
        });

        chartWrapper.appendChild(svg);
        return chartWrapper;
    }

})();
