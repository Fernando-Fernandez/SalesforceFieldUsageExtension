# Salesforce Field Usage Extension

This browser extension helps Salesforce administrators understand how their org is really using custom and standard fields so they can clean up technical debt and keep data quality high. Load it as an unpacked Chrome extension while you are logged in to Salesforce and open the popup to begin.

## What It Does
- **Field usage verification** - Runs targeted SOQL queries, inspects returned records, and reports the percentage of `NULL` values to highlight unused or underused fields.
- **Distinct value profiling** - Counts unique values within a field to reveal whether a single value dominates (indicating inaccurate user input) or whether the distribution reflects healthy usage.
- **Monthly trend analysis** - Aggregates records by month for each field value so admins can spot adoption trends, seasonal anomalies, and newly inactive data. The report renders both tables and log-scale charts with monthly bars broken down by value.

Use these insights to decide which fields can be deprecated, which require user training, and where data validation rules might be missing.

![Salesforce Field Usage summary report with field distributions](images/Salesforce%20Field%20Usage%20Report1.png)

![Salesforce Field Usage report detail showing charts, tables, and timeline](images/Salesforce%20Field%20Usage%20Report2.png)

## Usage
1. Open a Salesforce tab and then launch the extension popup.
2. Filter or select one or more SObjects, then optionally select specific fields. If you leave fields unselected, the extension falls back to the non-null usage plan for every field on the selected objects.
3. Click **Process Selections**. The status area shows separate progress counters for field queries and timeline queries so you know when the monthly data is running.
4. When processing finishes, the extension opens a `report.html` tab that displays the results. For field distributions, each card includes:
   - A horizontal bar chart of distinct values and their share of the total records.
   - A detailed table of value counts and percentages.
   - A monthly trend section with a stacked bar chart (log scale) plus a month/year table so you can see how each value evolves over the last 12 months.

## Loading the Extension
1. In Chrome, navigate to `chrome://extensions`, enable **Developer Mode**, and choose **Load unpacked**.
2. Select the repository root (`SalesforceFieldUsageExtension`) and pin the extension for easy access.

## Requirements & Notes
- You must already be authenticated in the Salesforce tab you query; the background service worker reuses the current session.
- Some field types (textarea/address) cannot be used as filter criteria, so the popup will skip them automatically.
- The timeline view only appears when specific fields are selected and data exists in the last 12 months. If there is no activity, the report explains that the timeline is empty.
