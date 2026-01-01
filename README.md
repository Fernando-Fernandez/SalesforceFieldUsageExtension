# Salesforce Field Usage Extension

This browser extension helps Salesforce administrators understand how their org is really using custom and standard fields so they can clean up technical debt and keep data quality high.

## What It Does
- **Field usage verification** - Runs targeted SOQL queries, inspects returned records, and reports the percentage of `NULL` values to highlight unused or underused fields.
- **Distinct value profiling** - Counts unique values within a field to reveal whether a single value dominates (indicating inaccurate user input) or whether the distribution reflects healthy usage.
- **Monthly trend analysis** - Aggregates records by month, returning both the total record count and the monthly distinct value count so admins can spot adoption trends or seasonal anomalies.

Use these insights to decide which fields can be deprecated, which require user training, and where data validation rules might be missing.
