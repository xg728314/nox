-- ============================================================
-- 170_rename_black_to_8beonga
-- ============================================================
-- 요청: 8층 매장 "블랙" 을 "8번가" 로 이름 변경.
-- 2026-07-24 R-external-dispatch 후속.
--
-- 안전 규칙:
--   1) floor = 8 AND store_name = '블랙' (deleted 제외) 인 row 만 대상.
--   2) 실제로 존재할 때만 UPDATE (매장 이름이 이미 바뀌었거나 다르면 no-op).
--   3) audit — 매장 rename 은 stores 자체 audit 필드 없음, audit_events 로 로그.
--
-- 이 파일은 apply 시 Supabase SQL 에디터 또는 CLI 로 실행.
-- ============================================================

DO $$
DECLARE
    target_id UUID;
    changed_count INT := 0;
BEGIN
    -- 대상 매장 확인
    SELECT id INTO target_id
    FROM stores
    WHERE store_name = '블랙'
      AND floor = 8
      AND deleted_at IS NULL
    LIMIT 1;

    IF target_id IS NULL THEN
        RAISE NOTICE '[170_rename_black] 8층 "블랙" 매장 없음. no-op.';
        RETURN;
    END IF;

    UPDATE stores
    SET store_name = '8번가',
        updated_at = now()
    WHERE id = target_id
      AND store_name = '블랙';

    GET DIAGNOSTICS changed_count = ROW_COUNT;
    RAISE NOTICE '[170_rename_black] renamed store id=% rows=%', target_id, changed_count;

    -- Audit
    INSERT INTO audit_events (
        store_uuid,
        actor_type,
        entity_table,
        entity_id,
        action,
        before,
        after
    ) VALUES (
        target_id,
        'system',
        'stores',
        target_id,
        'store_renamed',
        jsonb_build_object('store_name', '블랙'),
        jsonb_build_object('store_name', '8번가', 'reason', 'user request via /m external dispatch')
    );
END $$;
