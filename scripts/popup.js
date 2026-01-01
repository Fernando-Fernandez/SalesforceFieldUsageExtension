(function () {
    const API_VERSION = "v57.0";
    const MESSAGE_KEY = "getHostSession";
    const REQUEST_SOBJECTS = "getSObjects";
    const STORE_REPORT_DATA = "storeReportData";

    const statusEl = document.getElementById("status");
    const sobjectFilterEl = document.getElementById("sobjectFilter");
    const sobjectAvailableEl = document.getElementById("sobjectAvailable");
    const sobjectSelectedEl = document.getElementById("sobjectSelected");
    const addSobjectBtn = document.getElementById("addSobjectBtn");
    const removeSobjectBtn = document.getElementById("removeSobjectBtn");
    const fieldSectionEl = document.getElementById("fieldSection");
    const fieldAvailableEl = document.getElementById("fieldAvailable");
    const fieldSelectedEl = document.getElementById("fieldSelected");
    const addFieldBtn = document.getElementById("addFieldBtn");
    const removeFieldBtn = document.getElementById("removeFieldBtn");
    const processSelectionsBtn = document.getElementById("processSelectionBtn");
    const processStatusEl = document.getElementById("processStatus");

    const state = {
        host: null,
        sessionId: null,
        sobjects: [],
        filteredSObjects: [],
        fieldCache: new Map(),
        activeTab: null,
        selectedSObjects: [],
        selectedFields: new Map()
    };

    document.addEventListener("DOMContentLoaded", init);
    sobjectFilterEl.addEventListener("input", handleFilter);
    sobjectFilterEl.addEventListener("keydown", handleFilterKeydown);
    addSobjectBtn.addEventListener("click", handleAddSObjects);
    removeSobjectBtn.addEventListener("click", handleRemoveSObjects);
    addFieldBtn.addEventListener("click", handleAddFields);
    removeFieldBtn.addEventListener("click", handleRemoveFields);
    processSelectionsBtn.addEventListener("click", handleProcessSelections);
    updateProcessButtonState();
    setProcessStatus("");
    clearFieldLists();

    async function init() {
        try {
            try {
                state.activeTab = await queryActiveTab();
            } catch (tabError) {
                console.warn("Unable to determine active tab.", tabError);
            }

            const sessionInfo = await getSessionFromBackground(state.activeTab?.url);
            state.host = sanitizeDomain(sessionInfo.domain);
            state.sessionId = sessionInfo.session;
            setStatus(`Connected to ${state.host}`, "success");

            const loadedViaTab = await tryPopulateSObjectsFromTab();
            if (!loadedViaTab) {
                await loadSObjects();
            }
        } catch (error) {
            setStatus(error.message || "Unable to connect to Salesforce.", "error");
            console.error(error);
        }
    }

    function sanitizeDomain(domain) {
        if (!domain) {
            throw new Error("Salesforce domain not returned by background script.");
        }
        return domain.startsWith(".") ? domain.substring(1) : domain;
    }

    function getSessionFromBackground(tabUrl) {
        const referrer = document.referrer || tabUrl || "https://login.salesforce.com";
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { message: MESSAGE_KEY, url: referrer, tabUrl },
                (response) => {
                    if (!response) {
                        reject(new Error("Unable to read Salesforce session. Verify you are logged in."));
                        return;
                    }
                    resolve(response);
                }
            );
        });
    }

    async function loadSObjects() {
        setStatus("Loading SObjects…", "info");
        const endpoint = `https://${state.host}/services/data/${API_VERSION}/sobjects`;
        const result = await authenticatedFetch(endpoint);
        setSObjects(result.sobjects || []);
        setStatus(`Loaded ${state.sobjects.length} SObjects via API.`, "success");
    }

    async function tryPopulateSObjectsFromTab() {
        setStatus("Requesting SObjects from active tab…", "info");
        try {
            const activeTab = state.activeTab ?? await queryActiveTab();
            if (!activeTab || !activeTab.id) {
                throw new Error("No active Salesforce tab detected.");
            }
            const response = await sendMessageToTab(activeTab.id, { type: REQUEST_SOBJECTS });
            if (!response) {
                throw new Error("No response from active tab.");
            }
            if (response.error) {
                throw new Error(response.error);
            }
            if (!Array.isArray(response.sobjects) || response.sobjects.length === 0) {
                throw new Error("Active tab did not return SObjects.");
            }
            setSObjects(response.sobjects);
            setStatus(`Loaded ${state.sobjects.length} SObjects from active tab.`, "success");
            return true;
        } catch (error) {
            console.warn("Unable to populate SObjects from tab; falling back to REST API.", error);
            return false;
        }
    }

    function queryActiveTab() {
        return new Promise((resolve, reject) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                console.log("Active tabs: ", tabs);
                console.log("Active tab: ", tabs && tabs[0]);
                resolve(tabs && tabs[0]);
            });
        });
    }

    function sendMessageToTab(tabId, payload) {
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, payload, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(response);
            });
        });
    }

    async function authenticatedFetch(url, options = {}) {
        const requestOptions = {
            method: "GET",
            ...options
        };
        requestOptions.headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${state.sessionId}`,
            ...(options.headers || {})
        };

        const response = await fetch(url, requestOptions);

        if (!response.ok) {
            const payload = await response.text();
            throw new Error(`Salesforce API error (${response.status}): ${payload}`);
        }
        return response.json();
    }

    function handleFilter(event) {
        const term = event.target.value.trim().toLowerCase();
        if (!term) {
            state.filteredSObjects = state.sobjects.slice();
        } else {
            state.filteredSObjects = state.sobjects.filter(
                (obj) =>
                    obj.name.toLowerCase().includes(term) ||
                    obj.label.toLowerCase().includes(term)
            );
        }
        renderSObjectOptions();
        updateProcessButtonState();
    }

    async function handleFilterKeydown(event) {
        if (event.key !== "Enter") {
            return;
        }
        event.preventDefault();
        if (!state.filteredSObjects.length) {
            return;
        }
        const targetSObject = state.filteredSObjects[0];
        if (!targetSObject) {
            return;
        }
        if (state.selectedSObjects.includes(targetSObject.name)) {
            return;
        }
        state.selectedSObjects = [...state.selectedSObjects, targetSObject.name];
        renderSObjectOptions();
        await syncFieldSelectors(state.selectedSObjects);
        updateProcessButtonState();
    }

    function setSObjects(sobjects) {
        state.sobjects = sobjects
            .filter((obj) => obj && obj.name)
            .map((obj) => ({
                name: obj.name,
                label: obj.label || obj.name,
                key: `${obj.label || obj.name} (${obj.name})`
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
        const validNames = new Set(state.sobjects.map((obj) => obj.name));
        state.selectedSObjects = state.selectedSObjects.filter((name) => validNames.has(name));
        state.selectedFields = new Map(
            Array.from(state.selectedFields.entries()).filter(([name]) => validNames.has(name))
        );
        state.filteredSObjects = state.sobjects.slice();
        renderSObjectOptions();
        syncFieldSelectors(state.selectedSObjects);
        updateProcessButtonState();
    }

    function renderSObjectOptions() {
        const selectedSet = new Set(state.selectedSObjects);
        const availableObjects = state.filteredSObjects.filter((obj) => !selectedSet.has(obj.name));
        populateSObjectSelect(sobjectAvailableEl, availableObjects);

        const selectedObjects = state.selectedSObjects
            .map((name) => state.sobjects.find((obj) => obj.name === name))
            .filter(Boolean);
        populateSObjectSelect(sobjectSelectedEl, selectedObjects);

        toggleFieldSection(state.selectedSObjects.length > 0);
    }

    function populateSObjectSelect(selectEl, objects) {
        if (!selectEl) {
            return;
        }
        selectEl.innerHTML = "";
        objects.forEach((obj) => {
            const option = document.createElement("option");
            option.value = obj.name;
            option.textContent = obj.key;
            selectEl.appendChild(option);
        });
    }

    function toggleFieldSection(show) {
        if (!show) {
            clearFieldLists();
        }
    }

    async function syncFieldSelectors(selectedSObjects) {
        if (!selectedSObjects.length) {
            clearFieldLists();
            return;
        }

        setFieldSelectPlaceholder(fieldAvailableEl, "Loading fields…");
        setFieldSelectPlaceholder(fieldSelectedEl, "Loading fields…");
        await ensureFieldsLoaded(selectedSObjects);
        renderFieldLists();
    }

    async function handleAddSObjects() {
        const selections = getSelectedValues(sobjectAvailableEl);
        if (!selections.length) {
            return;
        }
        const nextSet = new Set(state.selectedSObjects);
        let changed = false;
        selections.forEach((value) => {
            if (!nextSet.has(value)) {
                nextSet.add(value);
                changed = true;
            }
        });
        if (!changed) {
            return;
        }
        state.selectedSObjects = Array.from(nextSet);
        renderSObjectOptions();
        await syncFieldSelectors(state.selectedSObjects);
        updateProcessButtonState();
    }

    async function handleRemoveSObjects() {
        const selections = getSelectedValues(sobjectSelectedEl);
        if (!selections.length) {
            return;
        }
        const selectionSet = new Set(selections);
        const nextSelected = state.selectedSObjects.filter((name) => !selectionSet.has(name));
        if (nextSelected.length === state.selectedSObjects.length) {
            return;
        }
        selections.forEach((name) => state.selectedFields.delete(name));
        state.selectedSObjects = nextSelected;
        renderSObjectOptions();
        await syncFieldSelectors(state.selectedSObjects);
        updateProcessButtonState();
    }

    function getSelectedValues(selectEl) {
        if (!selectEl) {
            return [];
        }
        return Array.from(selectEl.selectedOptions || []).map((opt) => opt.value);
    }

    function clearFieldLists() {
        setFieldSelectPlaceholder(fieldAvailableEl, "Select SObjects to load fields.");
        setFieldSelectPlaceholder(fieldSelectedEl, "Selected fields will appear here.");
        updateProcessButtonState();
    }

    function setFieldSelectPlaceholder(selectEl, message) {
        if (!selectEl) {
            return;
        }
        selectEl.innerHTML = "";
        const option = document.createElement("option");
        option.textContent = message;
        option.disabled = true;
        option.selected = true;
        selectEl.appendChild(option);
        selectEl.disabled = true;
    }

    async function getFieldsForSObject(sobject) {
        if (state.fieldCache.has(sobject)) {
            return state.fieldCache.get(sobject);
        }
        const endpoint = `https://${state.host}/services/data/${API_VERSION}/sobjects/${sobject}/describe`;
        const result = await authenticatedFetch(endpoint);
        const fields = (result.fields || [])
            .map((field) => ({
                name: field.name,
                label: field.label || field.name,
                type: field.type
            }))
            .sort((a, b) => a.label.localeCompare(b.label));

        state.fieldCache.set(sobject, fields);
        return fields;
    }

    async function ensureFieldsLoaded(sobjects) {
        const loadPromises = sobjects.map((sobject) => {
            if (state.fieldCache.has(sobject)) {
                return Promise.resolve();
            }
            return getFieldsForSObject(sobject);
        });
        await Promise.all(loadPromises);
    }

    function renderFieldLists() {
        populateFieldSelect(fieldAvailableEl, false);
        populateFieldSelect(fieldSelectedEl, true);
        updateProcessButtonState();
    }

    function populateFieldSelect(selectEl, useSelectedValues) {
        if (!selectEl) {
            return;
        }
        selectEl.innerHTML = "";
        let hasOptions = false;

        state.selectedSObjects.forEach((sobject) => {
            const fields = state.fieldCache.get(sobject) || [];
            if (!fields.length) {
                return;
            }
            const selectedNames = new Set(state.selectedFields.get(sobject) || []);
            const filteredFields = fields.filter((field) =>
                useSelectedValues ? selectedNames.has(field.name) : !selectedNames.has(field.name)
            );
            if (!filteredFields.length) {
                return;
            }
            const optGroup = document.createElement("optgroup");
            optGroup.label = getSObjectLabel(sobject);
            filteredFields.forEach((field) => {
                const option = document.createElement("option");
                option.value = buildFieldKey(sobject, field.name);
                option.textContent = `${field.label} (${field.name})`;
                option.dataset.sobject = sobject;
                option.dataset.field = field.name;
                option.dataset.type = field.type;
                optGroup.appendChild(option);
            });
            selectEl.appendChild(optGroup);
            hasOptions = true;
        });

        if (!hasOptions) {
            const message = useSelectedValues
                ? "No fields selected yet."
                : state.selectedSObjects.length
                    ? "All fields already selected."
                    : "Select SObjects to load fields.";
            setFieldSelectPlaceholder(selectEl, message);
        } else {
            selectEl.disabled = false;
        }
    }

    function handleAddFields() {
        const selections = getSelectedValues(fieldAvailableEl);
        if (!selections.length) {
            return;
        }
        let changed = false;
        selections.forEach((value) => {
            const parsed = parseFieldKey(value);
            if (!parsed) {
                return;
            }
            const { sobject, field } = parsed;
            const current = new Set(state.selectedFields.get(sobject) || []);
            if (!current.has(field)) {
                current.add(field);
                state.selectedFields.set(sobject, Array.from(current));
                changed = true;
            }
        });
        if (changed) {
            renderFieldLists();
            updateProcessButtonState();
        }
    }

    function handleRemoveFields() {
        const selections = getSelectedValues(fieldSelectedEl);
        if (!selections.length) {
            return;
        }
        let changed = false;
        selections.forEach((value) => {
            const parsed = parseFieldKey(value);
            if (!parsed) {
                return;
            }
            const { sobject, field } = parsed;
            const current = new Set(state.selectedFields.get(sobject) || []);
            if (current.delete(field)) {
                changed = true;
                if (current.size === 0) {
                    state.selectedFields.delete(sobject);
                } else {
                    state.selectedFields.set(sobject, Array.from(current));
                }
            }
        });
        if (changed) {
            renderFieldLists();
            updateProcessButtonState();
        }
    }

    function getSObjectLabel(apiName) {
        const match = state.sobjects.find((obj) => obj.name === apiName);
        return match ? `${match.label} (${match.name})` : apiName;
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

    function getFieldMetadata(sobject, fieldName) {
        const fields = state.fieldCache.get(sobject) || [];
        return fields.find((field) => field.name === fieldName);
    }

    function isFilterableField(fieldMeta) {
        if (!fieldMeta || !fieldMeta.type) {
            return true;
        }
        const type = fieldMeta.type.toLowerCase();
        return type !== "textarea" && type !== "address";
    }

    function chunkArray(array, size) {
        const result = [];
        for (let i = 0; i < array.length; i += size) {
            result.push(array.slice(i, i + size));
        }
        return result;
    }

    async function fetchQueryPlansBatch(batch) {
        if (!batch.length) {
            return new Map();
        }
        const endpoint = `https://${state.host}/services/data/${API_VERSION}/tooling/composite`;
        const compositeBody = {
            allOrNone: false,
            compositeRequest: batch.map((detail, index) => ({
                method: "GET",
                url: buildExplainUrl(detail.sobject, detail.field),
                referenceId: `plan${index}`
            }))
        };

        const response = await authenticatedFetch(endpoint, {
            method: "POST",
            body: JSON.stringify(compositeBody)
        });

        if (!response || !Array.isArray(response.compositeResponse)) {
            throw new Error("Composite API did not return the expected response.");
        }

        const resultMap = new Map();
        response.compositeResponse.forEach((subResponse, index) => {
            const detail = batch[index];
            const key = detail.key;
            if (subResponse.httpStatusCode >= 200 && subResponse.httpStatusCode < 300) {
                const plan = parsePlanFromResponse(subResponse.body);
                if (!plan) {
                    resultMap.set(key, { error: "Query plan missing cardinality data." });
                } else {
                    resultMap.set(key, { plan });
                }
            } else {
                resultMap.set(key, { error: extractCompositeError(subResponse.body) });
            }
        });

        return resultMap;
    }

    function buildExplainUrl(sobject, field) {
        const query = `SELECT count(Id) FROM ${sobject} WHERE ${field} != null`;
        return `/services/data/${API_VERSION}/tooling/query/?explain=${encodeURIComponent(query)}`;
    }

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

    function generateReportId() {
        return `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function storeReportData(results) {
        const payload = {
            reportId: generateReportId(),
            generatedAt: Date.now(),
            results
        };
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { type: STORE_REPORT_DATA, data: payload },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (!response || !response.success) {
                        reject(new Error(response?.error || "Failed to store report data."));
                        return;
                    }
                    resolve(payload.reportId);
                }
            );
        });
    }

    async function openResultsTab(results) {
        try {
            const reportId = await storeReportData(results);
            const reportUrl = chrome.runtime.getURL(`report.html?reportId=${reportId}`);
            chrome.tabs.create({ url: reportUrl });
        } catch (error) {
            console.error("Unable to open report tab", error);
            setStatus("Unable to open report tab. See console for details.", "error");
        }
    }

    function setStatus(message, type = "info") {
        statusEl.textContent = message;
        statusEl.className = `status status-${type}`;
    }

    function updateProcessButtonState() {
        if (!processSelectionsBtn) {
            return;
        }
        const hasSObjects = state.selectedSObjects.length > 0;
        const hasFilterText = sobjectFilterEl.value.trim().length > 0;
        const enableProcess = hasSObjects || hasFilterText;
        processSelectionsBtn.disabled = !enableProcess;
        if (!enableProcess) {
            setProcessStatus("");
        }
    }

    function setProcessStatus(message) {
        if (!processStatusEl) {
            return;
        }
        processStatusEl.textContent = message || "";
    }

    async function handleProcessSelections() {
        setProcessStatus("");

        const filterValue = sobjectFilterEl.value.trim();
        const filterMatch = filterValue
            ? state.sobjects.find(
                  (obj) =>
                      obj.name.toLowerCase() === filterValue.toLowerCase() ||
                      obj.label.toLowerCase() === filterValue.toLowerCase()
              )
            : null;

        const targetSObjects = state.selectedSObjects.length
            ? state.selectedSObjects.slice()
            : filterMatch
            ? [filterMatch.name]
            : [];

        if (!targetSObjects.length) {
            setStatus("Select at least one SObject before processing.", "error");
            return;
        }

        try {
            await ensureFieldsLoaded(targetSObjects);
        } catch (error) {
            setStatus(`Unable to load fields: ${error.message}`, "error");
            setProcessStatus("");
            return;
        }

        const selections = buildSelectionPairs(true, targetSObjects);
        if (!selections.length) {
            setStatus("No fields available to process.", "error");
            setProcessStatus("");
            return;
        }

        const totalRequests = selections.filter(({ sobject, field }) => {
            const meta = getFieldMetadata(sobject, field);
            return meta && isFilterableField(meta);
        }).length;

        setStatus("Processing selections…", "info");
        if (totalRequests > 0) {
            setProcessStatus(`Query plans: 0/${totalRequests} completed.`);
        } else {
            setProcessStatus("No query-plan API calls expected (all selections skipped).");
        }

        const selectionDetails = selections.map(({ sobject, field }) => {
            const meta = getFieldMetadata(sobject, field);
            return {
                sobject,
                field,
                key: buildFieldKey(sobject, field),
                sobjectLabel: getSObjectLabel(sobject),
                fieldLabel: meta?.label || field,
                metadata: meta
            };
        });

        const results = [];
        let completedRequests = 0;

        selectionDetails.forEach((detail) => {
            if (!detail.metadata) {
                results.push({
                    sobject: detail.sobject,
                    sobjectLabel: detail.sobjectLabel,
                    field: detail.field,
                    fieldLabel: detail.fieldLabel,
                    nonNullCount: null,
                    sobjectCount: null,
                    nonNullPercentage: null,
                    status: "Skipped: field metadata unavailable."
                });
            } else if (!isFilterableField(detail.metadata)) {
                results.push({
                    sobject: detail.sobject,
                    sobjectLabel: detail.sobjectLabel,
                    field: detail.field,
                    fieldLabel: detail.fieldLabel,
                    nonNullCount: null,
                    sobjectCount: null,
                    nonNullPercentage: null,
                    status: "Skipped: textarea/address fields cannot be used as filter criteria."
                });
            }
        });

        const requestableDetails = selectionDetails.filter(
            (detail) => detail.metadata && isFilterableField(detail.metadata)
        );

        for (const chunk of chunkArray(requestableDetails, 5)) {
            let batchResult;
            try {
                batchResult = await fetchQueryPlansBatch(chunk);
            } catch (error) {
                console.error("Composite batch failed", error);
                chunk.forEach((detail) => {
                    completedRequests += 1;
                    if (totalRequests > 0) {
                        setProcessStatus(`Query plans: ${completedRequests}/${totalRequests} completed.`);
                    }
                    results.push({
                        sobject: detail.sobject,
                        sobjectLabel: detail.sobjectLabel,
                        field: detail.field,
                        fieldLabel: detail.fieldLabel,
                        nonNullCount: null,
                        sobjectCount: null,
                        nonNullPercentage: null,
                        status: `Error: ${error.message || error}`
                    });
                });
                continue;
            }

            chunk.forEach((detail) => {
                completedRequests += 1;
                if (totalRequests > 0) {
                    setProcessStatus(`Query plans: ${completedRequests}/${totalRequests} completed.`);
                }
                const entry = batchResult.get(detail.key);
                if (!entry) {
                    results.push({
                        sobject: detail.sobject,
                        sobjectLabel: detail.sobjectLabel,
                        field: detail.field,
                        fieldLabel: detail.fieldLabel,
                        nonNullCount: null,
                        sobjectCount: null,
                        nonNullPercentage: null,
                        status: "Error: Missing response from composite batch."
                    });
                } else if (entry.error) {
                    results.push({
                        sobject: detail.sobject,
                        sobjectLabel: detail.sobjectLabel,
                        field: detail.field,
                        fieldLabel: detail.fieldLabel,
                        nonNullCount: null,
                        sobjectCount: null,
                        nonNullPercentage: null,
                        status: `Error: ${entry.error}`
                    });
                } else {
                    results.push({
                        sobject: detail.sobject,
                        sobjectLabel: detail.sobjectLabel,
                        field: detail.field,
                        fieldLabel: detail.fieldLabel,
                        nonNullCount: entry.plan.nonNullCount,
                        sobjectCount: entry.plan.sobjectCount,
                        nonNullPercentage: entry.plan.nonNullPercentage,
                        status: "Success"
                    });
                }
            });
        }

        if (results.length) {
            openResultsTab(results);
            setStatus(`Processed ${results.length} field(s).`, "success");
            if (totalRequests > 0) {
                setProcessStatus(`Completed ${completedRequests}/${totalRequests} API calls.`);
            } else {
                setProcessStatus("Completed with skipped fields only.");
            }
        } else {
            setStatus("No results to display.", "error");
            setProcessStatus("");
        }
    }

    function buildSelectionPairs(includeAllWhenEmpty = false, targetSObjects = state.selectedSObjects) {
        const pairs = [];
        targetSObjects.forEach((sobject) => {
            let fields = state.selectedFields.get(sobject) || [];
            if ((!fields || fields.length === 0) && includeAllWhenEmpty) {
                const described = state.fieldCache.get(sobject) || [];
                fields = described.map((field) => field.name);
            }
            fields.forEach((field) => {
                pairs.push({ sobject, field });
            });
        });
        return pairs;
    }
})();
