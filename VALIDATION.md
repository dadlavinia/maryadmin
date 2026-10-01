# Validation

- 28 automated checks passed: 17 PostgreSQL workflow/security tests and 11 API/import/export tests.
- Production build and JavaScript syntax checks passed.
- 11 integrated browser checks passed on desktop and mobile using the shipped seed: 20 customers, 200 invoices, and simulated payments in an isolated PostgreSQL test database.
- Overview customer/date/amount filters, automatic application, quick periods, reset, empty results, invalid ranges and stale response handling verified.
- Chart totals, aging, payment mix, customer balances and overdue rows reconcile to the same filtered invoice cohort.
- Report criteria, exact snapshot exports, changed-filter download locking and compact table rows verified.
- Excel summary/report/parameter worksheets and typed amounts verified.
- PDF pages rendered and inspected. Long history content verified through its final entry; fonts are embedded and continuation pages remain readable.
- Compiled admin included for Windows installations that block native Rollup builds.

Tests use PGlite PostgreSQL and a test authentication/Supabase adapter. A live Supabase project was not connected. Run database/004_filtered_overview.sql in your existing project to enable the new overview endpoint.
