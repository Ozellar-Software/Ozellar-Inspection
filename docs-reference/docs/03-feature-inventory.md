# 03 — Feature inventory (parity checklist for the rebuild)

Use this as the acceptance checklist: every row must work in the new system before switching over. "→" notes how the feature changes in the target architecture.

## A. Sign-in & accounts
| # | Feature | Current behaviour | Target |
|---|---|---|---|
| A1 | Sign in | email + password (Supabase) | → Microsoft 365 / Entra ID sign-in (SSO) |
| A2 | Admin sets initial password / resets password | Manage users → ⋮ → Set password | → not needed (Entra). Guests invited via Entra B2B |
| A3 | Change own password | account menu | → handled by Microsoft account |
| A4 | Forgot password (email link / 6-digit code) | limited by Supabase email | → handled by Microsoft account |
| A5 | "Create your password" after invite link | yes | → not needed |
| A6 | Bootstrap admin | `pavan.trivedi96@gmail.com` hard-coded | → first Admin set in Entra group / seed data |
| A7 | Sign out | account menu | same |

## B. Users & roles (Admin)
| # | Feature | Notes |
|---|---|---|
| B1 | Roles: Admin, Director, Tech Manager, Vessel Manager | permissions matrix in `09-security-and-roles.md` |
| B2 | Assign role, name, **designation** (pick-list + "Other…") | designation list = presets + any used before |
| B3 | Assign vessels (fleet) to Tech/Vessel Managers | at least one vessel required for those roles |
| B4 | Edit role, remove access | |
| B5 | Invite message to copy/share | → Entra invitation / welcome email |
| B6 | "My assigned vessels" in ☰ menu (Tech/Vessel Manager) → opens New inspection pre-selected | |
| B7 | "Signed in as <role> · <name> — <designation>" | |

## C. Vessels
| # | Feature | Notes |
|---|---|---|
| C1 | Vessel list (Admin add/edit/delete; Director view) | |
| C2 | Particulars: name, IMO, type + 23 extra fields (flag, port of registry, call sign, official no., year built, yard, class society, notation, GT, NT, DWT, LOA, breadth, depth, summer draft, main engine, maker/model, power, propulsion, owner, manager/operator, vessel email, sat phone) | carried into report |
| C3 | Vessel photo | |
| C4 | Fleet inspection status: 6-month cycle — On track (<5 mo), Due soon (5–6 mo), Overdue (≥6 mo / none); counts banner on home; table view | based on last **approved/completed** inspection's completion date (or start date) |
| C5 | Vessel inspection history | |
| C6 | Managers only see assigned vessels; dropdown always lists assigned vessels even before sync | |

## D. Checklist template (Admin)
| # | Feature | Notes |
|---|---|---|
| D1 | Master checklist: 75 sections / 221 questions in 3 zones (Outside, Inside, Engine Room) | seed: `starter/db/seed/default-checklist.json` |
| D2 | Add / rename / delete / reorder sections and questions | permanent ids (`sr`, `qId`) never reused |
| D3 | **Photo sections** (photos only, defect marking, up to 100 photos) | internal photo store — **never printed in reports** |
| D4 | New inspections take a frozen copy of the template; template edits don't change existing inspections… | |
| D5 | …**except Photo sections**, which are added to every not-yet-completed inspection on all vessels | |
| D6 | Add section inside one inspection (Admin only): Findings section or Photo section, with "Add to all vessels" | |
| D7 | Convert a single-inspection Photo section to all vessels (moves its photos) | |

## E. Inspections
| # | Feature | Notes |
|---|---|---|
| E1 | Create: vessel (dropdown), IMO, type, inspection type **Port / Remote / Sailing** with type-specific dates & ports, start/completion date, inspector, company/rank | Directors cannot create |
| E2 | Edit vessel details (locked when submitted/approved) | |
| E3 | Section list with progress (x/y), photo counts, defect counts, search | |
| E4 | Question card: Applicable / N/A → Yes-satisfactory / No-observation, Remark, Corrective action, Preventive action, photos | |
| E5 | Section photos (general) | |
| E6 | Extra observations per section (text, finding, actions, photos) | |
| E7 | Cover photo; Summary & Conclusion (required before submit) | |
| E8 | Delete inspection (not Directors; not when submitted/approved) | |
| E9 | **Normal / Light mode** (per device, main page switch): Light = only Photo sections listed | |
| E10 | Home: list, search by vessel, status chips (In progress / Waiting: Tech Manager / Waiting: Director / Approved / Rejected) | |

## F. Photos
| # | Feature | Notes |
|---|---|---|
| F1 | Take photo (camera) / Upload (multi-select, up to 15 per question/section; 100 in Photo sections) | compressed to JPEG on device |
| F2 | Mark photo as defect (dark-red frame), prompt after each Photo-section photo | |
| F3 | Select mode (tap Select / long-press), select all, move photos between sections/questions, drag to reorder / move | |
| F4 | Delete photo | |
| F5 | Photos load from cloud if missing locally ("heal") | |

## G. Report & export
| # | Feature | Notes |
|---|---|---|
| G1 | In-app report screen: stats (total, satisfactory, observations, N/A, pending, photos, extra findings), observation list (tap to open) | |
| G2 | **PDF** (jsPDF, on device, works offline): cover (photo, date, port, inspector, status), summary, vessel particulars, inspection particulars, inspection done report (per section: photos then questions with status tag, remarks, actions, photos), observation list, conclusion | **No** section numbers, **no** Photo sections, **no** "General Section photos" label, **no** "Red frame = defect" note, **no** approval record. Defect photos keep red border |
| G3 | Printable HTML report (fallback when jsPDF unavailable) | same rules as G2 |
| G4 | CSV export | excludes Photo sections |
| G5 | JSON backup export / import (per inspection) | |
| G6 | Backup reminder bar | |

## H. Approvals
| # | Feature | Notes |
|---|---|---|
| H1 | Submit for approval (Summary + Conclusion required) | Vessel Manager → picks Tech Manager who has that vessel; Tech Manager/Admin → picks Director |
| H2 | Level-1 (Tech Manager): Approve & pick Director / Reject with reason → back to Vessel Manager | |
| H3 | Final (Director): Final approval / Reject with reason → back to submitter | |
| H4 | Admin can act at any level; Admin can reopen approved | |
| H5 | Locking: submitted → nobody edits until approved or rejected; approved → view-only | enforced on **server** in target |
| H6 | Director always view-only (no edit/delete) | |
| H7 | Notices on home: "Waiting for your approval (n)", "Rejected — returned to you (n)" | |
| H8 | Approval history (who, designation, role, level, date/time, comment) on report screen | not printed |
| H9 | Emails at each step | → Microsoft Graph from an @ozellar.com mailbox |
| H10 | Old "completed" inspections can be submitted | migration: map to `approved` or `in_progress`? (decision in `14-…`) |

## I. Offline, sync, app updates
| # | Feature | Notes |
|---|---|---|
| I1 | Works fully offline; saves locally first | |
| I2 | Sync on open / online / "Sync now"; status bar "Synced just now" | |
| I3 | Company-wide shared data (filtered by role) | |
| I4 | Save verification + failure banner | |
| I5 | Installable app; offline start | |
| I6 | "New version available — tap to update" bar | |
