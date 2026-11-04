-- =====================================================================
-- Ozellar VIR: Backfill Observations for Existing Defect Photos
--
-- This script scans for photos marked as `is_defect = true` that are
-- assigned to a section but do not have an observation (finding) linked yet.
-- For each such photo, it creates a new Observation record in `findings`,
-- links the photo to it, and updates row_version so all devices sync it.
--
-- Safe & idempotent: Only touches photos where finding_id IS NULL.
-- =====================================================================

DO $$
DECLARE
  rec RECORD;
  new_finding_id UUID;
  max_pos INT;
  created_count INT := 0;
BEGIN
  FOR rec IN
    SELECT p.id AS photo_id, p.inspection_id, p.inspection_section_id, p.description
    FROM photos p
    WHERE p.is_defect = true
      AND p.finding_id IS NULL
      AND p.inspection_section_id IS NOT NULL
      AND p.deleted_at IS NULL
    ORDER BY p.inspection_section_id, p.position, p.created_at ASC
  LOOP
    new_finding_id := gen_random_uuid();

    SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos
    FROM findings
    WHERE inspection_section_id = rec.inspection_section_id
      AND deleted_at IS NULL;

    INSERT INTO findings (
      id,
      inspection_id,
      inspection_section_id,
      text,
      answer,
      corrective_action,
      preventive_action,
      position,
      updated_at,
      row_version
    ) VALUES (
      new_finding_id,
      rec.inspection_id,
      rec.inspection_section_id,
      COALESCE(NULLIF(TRIM(rec.description), ''), 'Defect observation logged from visual evidence'),
      'no',
      '',
      '',
      max_pos,
      NOW(),
      nextval('sync_seq')
    );

    UPDATE photos
    SET finding_id = new_finding_id,
        updated_at = NOW(),
        row_version = nextval('sync_seq')
    WHERE id = rec.photo_id;

    created_count := created_count + 1;
  END LOOP;

  RAISE NOTICE 'Backfill complete: Created % observation(s) for unlinked defect photos.', created_count;
END $$;
