-- =====================================================================
-- Ozellar VIR: Backfill Observations for Existing Defect Photos
--
-- This script automatically scans for photos marked as `is_defect = true`
-- that are assigned to a section but do not have an observation (finding) linked yet.
-- For each such photo, it creates an Observation record in `findings`,
-- links the photo to it, and updates row_version so all devices sync it.
--
-- Safe & idempotent: Only touches photos where finding_id IS NULL.
-- =====================================================================

WITH unlinked AS (
  SELECT
    p.id AS photo_id,
    p.inspection_id,
    p.inspection_section_id,
    p.created_by,
    COALESCE(NULLIF(TRIM(p.description), ''), 'Defect observation logged from visual evidence') AS f_text,
    gen_random_uuid() AS new_finding_id,
    ROW_NUMBER() OVER (PARTITION BY p.inspection_section_id ORDER BY p.position, p.created_at) AS rn
  FROM photos p
  WHERE p.is_defect = true
    AND p.finding_id IS NULL
    AND p.inspection_section_id IS NOT NULL
    AND p.deleted_at IS NULL
),
section_max AS (
  SELECT
    inspection_section_id,
    COALESCE(MAX(position), -1) AS max_pos
  FROM findings
  WHERE deleted_at IS NULL
  GROUP BY inspection_section_id
),
inserted AS (
  INSERT INTO findings (
    id,
    inspection_id,
    inspection_section_id,
    text,
    answer,
    corrective_action,
    preventive_action,
    position,
    updated_by,
    updated_at,
    row_version
  )
  SELECT
    u.new_finding_id,
    u.inspection_id,
    u.inspection_section_id,
    u.f_text,
    'no',
    '',
    '',
    COALESCE(sm.max_pos, -1) + u.rn,
    u.created_by,
    NOW(),
    nextval('sync_seq')
  FROM unlinked u
  LEFT JOIN section_max sm ON sm.inspection_section_id = u.inspection_section_id
  RETURNING id
)
UPDATE photos p
SET finding_id = u.new_finding_id,
    updated_at = NOW(),
    row_version = nextval('sync_seq')
FROM unlinked u
WHERE p.id = u.photo_id;
