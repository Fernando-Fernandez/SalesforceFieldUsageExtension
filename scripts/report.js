(function () {
    const GET_REPORT_DATA = "getReportData";

    const statusEl = document.getElementById("reportStatus");
    const tableSectionEl = document.getElementById("reportTableSection");
    const tableBodyEl = document.getElementById("reportTableBody");
    const metaEl = document.getElementById("reportMeta");
    const tableHeaders = Array.from(document.querySelectorAll("th[data-sort-key]"));
    const histogramSectionEl = document.getElementById("histogramSection");
    const histogramCanvas = document.getElementById("histogramCanvas");
    const histogramLegendEl = document.getElementById("histogramLegend");

    const state = {
        results: [],
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
            renderTable(state.results);
            renderHistogram(state.results);
            setStatus("Report ready.", "info");
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
            row.appendChild(createCell(formatNumber(result.sobjectcardinality)));
            row.appendChild(createCell(formatNumber(result.cardinality)));
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
        if (typeof value !== "number" || isNaN(value)) {
            return "—";
        }
        return value.toLocaleString();
    }

    function formatPercentage(value) {
        if (typeof value !== "number" || isNaN(value)) {
            return "—";
        }
        return `${(value * 100).toFixed(2)}%`;
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
            case "sobjectcardinality":
                return result.sobjectcardinality;
            case "cardinality":
                return result.cardinality;
            case "nonNullPercentage":
                return result.nonNullPercentage;
            case "status":
                return result.status;
            default:
                return null;
        }
    }

    function renderHistogram(results) {
        if (!histogramSectionEl || !histogramCanvas) {
            return;
        }
        const ctx = histogramCanvas.getContext("2d");
        const values = results
            .map((result) => typeof result.nonNullPercentage === "number" ? result.nonNullPercentage * 100 : null)
            .filter((value) => value != null && !isNaN(value));

        if (!values.length) {
            histogramSectionEl.hidden = true;
            return;
        }

        histogramSectionEl.hidden = false;

        const bins = new Array(10).fill(0);
        values.forEach((value) => {
            const clamped = Math.min(99.999, Math.max(0, value));
            const index = Math.min(bins.length - 1, Math.floor(clamped / 10));
            bins[index] += 1;
        });

        const width = histogramCanvas.width;
        const height = histogramCanvas.height;
        ctx.clearRect(0, 0, width, height);

        const padding = 32;
        const plotWidth = width - padding * 2;
        const plotHeight = height - padding * 2;
        const barWidth = plotWidth / bins.length - 5;
        const maxCount = Math.max(...bins);

        ctx.strokeStyle = "#d0d7e5";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, padding + plotHeight);
        ctx.lineTo(padding + plotWidth, padding + plotHeight);
        ctx.stroke();

        ctx.fillStyle = "#7cb7ff";
        ctx.textAlign = "center";
        ctx.font = "12px sans-serif";

        bins.forEach((count, index) => {
            const x = padding + index * (plotWidth / bins.length) + 2.5;
            const barHeight = maxCount === 0 ? 0 : (count / maxCount) * (plotHeight - 10);
            const y = padding + plotHeight - barHeight;
            ctx.fillRect(x, y, barWidth, barHeight);

            const label = `${index * 10}-${index * 10 + 10}%`;
            ctx.fillStyle = "#1f1f1f";
            ctx.fillText(label, x + barWidth / 2, padding + plotHeight + 16);
            ctx.fillStyle = "#7cb7ff";
        });

        ctx.fillStyle = "#1f1f1f";
        ctx.textAlign = "right";
        ctx.fillText(`Max: ${maxCount}`, width - padding, padding - 10);

        if (histogramLegendEl) {
            histogramLegendEl.textContent = `Histogram based on ${values.length} field(s). Bin width: 10 percentage points.`;
        }
    }
})();
