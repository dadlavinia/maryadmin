# Mary Collections

1. Install Node.js 22 or later. Extract `mary-collections` and run `INSTALL.cmd`.
2. Create a **new Supabase project**. Run `database/001_schema.sql`, then `database/004_filtered_overview.sql` in SQL Editor.
3. In Supabase Authentication, create the first user. Replace the email in `database/002_create_owner.sql` and run it once.
4. In `backend/.env`, enter the project URL and **publishable key** (or legacy **anon** key).
5. In Supabase Authentication URL Configuration, set Site URL to `http://127.0.0.1:4000`. Add `http://127.0.0.1:4000` and `http://127.0.0.1:3001` to Redirect URLs. Disable public signups. Set the minimum password length to 10 or more.
6. Run `START.cmd`. Open `http://127.0.0.1:4000` and sign in.

Use `DEV.cmd` for development. Use `VERIFY.cmd` for checks.

## Imports

CSV and `.xlsx`, one worksheet, up to 5 MB and 5,000 rows. Map columns, preview, import. Dates: `YYYY-MM-DD`. Formula cells: paste values first. Source invoice numbers: format cells as Text.

Required: `customer_name`, `invoice_number`, `invoice_date`, `due_date`, `amount`.
Optional: `customer_code`, `email`, `phone`, `notes`.

Match: customer code; otherwise exact customer name. Repeated names require a customer code. Existing invoices match customer + source invoice number. Imports retain recorded payments and action status. Blank notes retain existing notes. Invalid rows block the batch. Download rejected rows and upload the corrected file.

Generated IDs: `INV-MM-YYYY-00001` through `INV-MM-YYYY-10000`. The serial resets each year; month and year use Africa/Nairobi at creation. The source invoice number is stored separately. Both are searchable.

## Staff

Create each user in Supabase Authentication, then add their email in **Team**.

| Role | Access |
| --- | --- |
| Owner | All features; administrator access |
| Admin | Customer/invoice entry, imports, payments, reversals, collector/viewer access |
| Collector | Customer/invoice entry, imports, payments, reports, history |
| Viewer | Read and export |

Accounts are scoped to their workspace. Direct financial writes and audit edits are blocked; guarded database functions handle changes.

## Reports

Set combined filters, press **OK**, then download Excel, CSV or PDF. Changing filters disables download until OK is pressed again. Applied rows and parameters are fixed for 24 hours. Press OK to refresh. Amounts show the current ledger position when applied; date filters select invoices, collections or events by their respective dates. Financial values are in the workspace currency, initially KES.

## Server

A Node server is required. It serves the built admin, validates files and generates exports. Supabase stores invoices, payments, staff access and history.

For a hosted server, use HTTPS, set `HOST=0.0.0.0`, `NODE_ENV=production`, and `ALLOWED_ORIGINS` to the actual admin URL. Update Supabase Site URL/Redirect URLs. Set reverse-proxy uploads to at least 5 MB. Keep `.env` out of source control. The application does not use a service-role key.

## Verification

`database/003_verify_security.sql`: grant/RLS checks and ledger reconciliation.
`npm run verify`: database workflow/security tests, import/export/API tests, syntax checks and production build.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase functions](https://supabase.com/docs/guides/database/functions), [PostgreSQL INSERT](https://www.postgresql.org/docs/current/sql-insert.html).

## Overview

Customer, invoice date, due date, amount, balance, payment, action and overdue filters apply to every overview chart, total and overdue row. Changes apply automatically; Apply also refreshes the selection. Month, last three months and year shortcuts select invoice dates. The trend shows invoices issued and collections recorded for the selected invoices, grouped by month. Without invoice date filters, the trend shows the last six months; other visuals cover the full selected register.

## Updating an existing installation

Keep `backend/.env`. Close the server window, merge the update into `D:\mary-collections`, run only `database/004_filtered_overview.sql` in Supabase SQL Editor, and run `START.cmd`. Do not rerun the initial schema or owner setup. The ZIP includes the compiled admin; rebuilding on Windows is unnecessary.
