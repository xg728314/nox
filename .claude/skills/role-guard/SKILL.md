---
name: role-guard
description: NOX 페이지/API 생성 시 role 가드 · membership status · deleted_at 필터 강제
---

# Role Guard

새 페이지 또는 API route 생성/수정 시 반드시 실행.

## API route 최소 가드

```typescript
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    // role 검증
    if (!["owner", "manager"].includes(auth.role) && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    // 이후 auth.store_uuid, auth.membership_id 사용
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
```

## 페이지 role 가드 매핑

| role | 기본 경로 |
|------|---------|
| `owner` | `/owner` |
| `manager` | `/manager` |
| `hostess` | `/me` |
| `counter` | `/counter` (delegated actor, 실제 role 은 owner/manager) |

- 미승인 (`membership_status != 'approved'`) → 401
- 잘못된 role 접근 시 자신의 홈으로 리다이렉트

## membership 검증

- `is_primary = true AND status = 'approved'` 만 access grant
- `deleted_at IS NULL` 필수 (skill-schema-validator 와 겹침)

## super_admin bypass

- `auth.is_super_admin === true` 시 store_uuid scope 우회 가능
- SELECT/UPDATE **양쪽** 조건 분기 필수 (한쪽만 하면 VERSION_CONFLICT 발생 이력 있음)

## counter 특수

- `counter` 는 role enum 값 아님 — delegated UI actor
- 실제 DB 기록은 owner/manager 의 user_id + `actor_type: "counter"` audit 태그

## 체크리스트

- [ ] `resolveAuthContext(request)` 호출
- [ ] role 검증 후 store_uuid scope 적용
- [ ] deleted_at IS NULL 조건 (해당 테이블만)
- [ ] super_admin 필요 시 양쪽 분기
- [ ] AuthError catch → 정확한 status code 반환
