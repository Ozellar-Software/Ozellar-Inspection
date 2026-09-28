# 13 — Costs & operations

Prices change and depend on region — build the estimate in the **Azure Pricing Calculator** (azure.microsoft.com/pricing/calculator) with the drivers below. No figures are quoted here on purpose.

## Cost drivers
| Service | Tier to start | Main driver |
|---|---|---|
| Static Web Apps | Standard (needed for linked backend + custom auth) | fixed monthly per app |
| Azure Functions | Flex Consumption | executions + GB-seconds (low for this workload) |
| PostgreSQL Flexible Server | Burstable B1ms, 32 GB storage | compute hours (always on) + storage + backup retention |
| Blob Storage | Hot, LRS (or ZRS) | **photo GB stored** + transactions — the biggest growth item |
| Application Insights | pay-as-you-go | log volume (set daily cap / sampling) |
| Key Vault | Standard | negligible |
| Entra ID | included with Microsoft 365 | guests: first tier of monthly active guests typically free (check current terms) |
| Apple / Google developer accounts | yearly / one-off | needed for store apps |

Estimate photo storage: `inspections per year × photos per inspection × ~0.4 MB` (compressed on device).

## Operations
| Task | How | Frequency |
|---|---|---|
| Deploy | merge to `main` → GitHub Actions | per change |
| Backups | Postgres PITR (auto); Blob soft delete + versioning | automatic; **test a restore quarterly** |
| Monitoring | App Insights alerts (failures, latency), Postgres CPU/storage | continuous |
| Patching | managed by Azure (no VMs) | — |
| User admin | in-app Manage users (Admin); leavers disabled in Entra automatically lose access | as needed |
| Cost control | budgets + alerts on the resource group | monthly review |
| Photo lifecycle | optional: move photos older than 2 years to Cool tier | yearly review |
