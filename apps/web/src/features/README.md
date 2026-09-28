# Features to port from the current app

Each folder owns its screens, hooks and API calls. Acceptance criteria: `docs/03-feature-inventory.md`.
Reference implementation: `current-app/index.html` (search for the function names below).

| Folder | Build | Port from (current app functions) |
|---|---|---|
| `home/` | ✅ started: sync bar, approval notices, Normal/Light switch, search, list | `renderHome`, `approvalNoticesHTML`, `modeToggleHTML` |
| `inspections/` | New/Edit form (vessel dropdown incl. assigned vessels, Port/Remote/Sailing dates), section list (progress, photo & defect counts, search, Light mode filter, Admin Add section), section detail, question card, findings | `renderForm`, `renderSectionList`, `renderSectionDetail`, `questionCardHTML`, `customFindingHTML`, `mergeTemplatePhotoSections` |
| `photos/` | camera/upload (multi), compress, defect prompt & red frame, Select mode, move, drag reorder, delete | `wirePhotoThumbs`, `wireSelectPhotosButton`, `wireThumbDrag`, `compressImage` → use `offline/photoQueue.ts#addPhoto` |
| `report/` | report screen stats + observation list, **on-device PDF** (no section numbers, no Photo sections, no labels, no approval record), printable, CSV, JSON backup/import | `renderReport`, `buildInspectionPDF`, `buildPrintableReport`, `exportInspectionCSV`, `exportInspectionJSON` |
| `approvals/` | Submit / Approve & pick Director / Final approval / Reject (reason) / Reopen sheets, history panel, lock banner | `approvalPanelHTML`, `approvalSheet` → call `/inspections/{id}/submit|approve|reject|reopen` |
| `vessels/` | list, form with 23 particulars, photo, history, fleet status table | `renderVessels`, `renderVesselForm`, `renderFleetStatus`, `renderVesselHistory` |
| `users/` | Manage users (role, vessels, designation pick-list with "Other…") | `renderManageUsers`, `renderAssignUser`, `designationFieldHTML` |
| `checklist/` | template editor: sections/questions add/rename/delete/reorder, Photo sections | `renderManageChecklist`, `renderManageChecklistSection` |

Rules to reuse, not rewrite: `@ozellar/shared` → `can()`, `isEditable()`, `canActOnApproval()`, `STATUS_LABELS`, `inspectionDueInfo()`, `personLabel()`, `DESIGNATION_PRESETS`.
