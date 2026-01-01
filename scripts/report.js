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
        statusEl.textContent = message;
        statusEl.className = `status status-${type}`;
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
