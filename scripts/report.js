(function () {
    const GET_REPORT_DATA = "getReportData";

    const statusEl = document.getElementById("reportStatus");
    const tableSectionEl = document.getElementById("reportTableSection");
    const tableBodyEl = document.getElementById("reportTableBody");
    const metaEl = document.getElementById("reportMeta");
    const tableHeaders = Array.from(document.querySelectorAll("th[data-sort-key]"));
    const chartSectionEl = document.getElementById("chartSection");
    const chartContainerEl = document.getElementById("fieldChartContainer");
    const distributionSectionEl = document.getElementById("distributionSection");
    const distributionContainerEl = document.getElementById("distributionTables");

    const state = {
        results: [],
        mode: "summary",
        sortKey: null,
        sortDirection: "asc"
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
            renderMeta(reportData.generatedAt);

            const hasDistribution = state.results.some((result) => Array.isArray(result.rows));
            if (hasDistribution) {
                state.mode = "distribution";
                renderDistributionTables(state.results);
                if (chartSectionEl) {
                    chartSectionEl.hidden = true;
                }
                tableSectionEl.hidden = true;
                clearStatus();
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
            clearStatus();
            tableSectionEl.hidden = false;
        } catch (error) {
            console.error("Unable to load report", error);
            setStatus(error.message || "Unable to load report.", "error");
        }
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
            row.appendChild(createCell(result.fieldLabel));
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

    function sortResults(results, key, direction) {
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

            distributionContainerEl.appendChild(card);
        });
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

    function formatTimelinePeriod(year, month) {
        if (!year || !month) {
            return "—";
        }
        const date = new Date(year, month - 1, 1);
        return date.toLocaleString(undefined, { month: "short", year: "numeric" });
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

    function getTimelinePeriods(rows) {
        const map = new Map();
        rows.forEach((row) => {
            if (!row.year || !row.month) {
                return;
            }
            const key = `${row.year}-${row.month}`;
            if (!map.has(key)) {
                const date = new Date(row.year, row.month - 1, 1);
                map.set(key, {
                    key,
                    sortValue: row.year * 100 + row.month,
                    label: formatTimelinePeriod(row.year, row.month),
                    monthLabel: date.toLocaleString(undefined, { month: "short" }),
                    yearLabel: date.getFullYear().toString()
                });
            }
        });
        return Array.from(map.values()).sort((a, b) => a.sortValue - b.sortValue);
    }

    function getTimelineValues(rows) {
        const seen = new Map();
        rows.forEach((row) => {
            const label = formatDistributionValue(row.value);
            if (!seen.has(label)) {
                seen.set(label, label);
            }
        });
        return Array.from(seen.keys());
    }

    function buildTimelineGroupMap(rows) {
        const groupMap = new Map();
        rows.forEach((row) => {
            if (!row.year || !row.month) {
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

    function chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
})();
