# Page → API Endpoint 호출 그래프 (자동 생성)

> 마지막 생성: 2026-06-02

## 페이지별 호출 endpoint (정방향)

### /admin

- /api/admin/dashboard

### /admin/approvals

- /api/store/approvals

### /admin/deployments

- /api/admin/deployments

### /admin/learn

- /api/learn/stats

### /admin/location-corrections

- /api/location/corrections/by-user

### /admin/members/create

- /api/admin/members/create

### /admin/reconcile-grants

- /api/reconcile/grants
- /api/reconcile/grants/${id}
- /api/reconcile/learn
- /api/store/staff

### /attendance

- /api/attendance

### /audit

- /api/audit

### /audit-events

- /api/audit-events

### /ble

- /api/ble/presence

### /cafe/[store_uuid]

- /api/cafe/storefront/${storeId}

### /cafe/admin

- /api/cafe/admin/overview

### /cafe/admin/[store_uuid]/inbox

- /api/cafe/orders/inbox
- /api/cafe/stores

### /cafe/manage

- /api/auth/logout

### /cafe/manage/account

- /api/cafe/account

### /cafe/manage/credits

- /api/cafe/credits${unpaidOnly
- /api/cafe/credits/${id}/pay

### /cafe/manage/finance

- /api/cafe/finance

### /cafe/manage/inbox

- /api/cafe/credits
- /api/cafe/orders/${id}
- /api/cafe/orders/inbox

### /cafe/manage/menu

- /api/cafe/menu
- /api/cafe/menu/${id}
- /api/cafe/menu/${newId}/options
- /api/cafe/menu/${newId}/recipes
- /api/cafe/supplies
- /api/cafe/upload

### /cafe/manage/pos

- /api/cafe/menu/${id}/recipes
- /api/cafe/orders/inbox

### /cafe/manage/store

- /api/cafe/supplies
- /api/cafe/supplies/${adjustFor}
- /api/cafe/supplies/${id}
- /api/cafe/supplies/purchases

### /counter/[room_id]/bill

- /api/rooms
- /api/sessions/bill

### /counter/[room_id]/checkin

- /api/rooms/${roomId}
- /api/sessions/checkin
- /api/sessions/participants
- /api/sessions/participants/batch
- /api/store/staff

### /counter/[room_id]/checkout

- /api/rooms/${roomId}/participants
- /api/sessions/checkout
- /api/sessions/participants/${p.id}
- /api/sessions/settlement

### /counter/[room_id]/payment

- /api/rooms
- /api/sessions/settlement/payment
- /api/store/settings

### /counter/[room_id]/pre-settlement

- /api/rooms
- /api/sessions/pre-settlement
- /api/store/staff

### /credits

- /api/credits
- /api/credits/${creditId}
- /api/rooms
- /api/store/staff

### /customers

- /api/customers

### /customers/[customer_id]

- /api/customers/${customer_id}

### /customers/[customer_id]/receipt/[snapshot_id]

- /api/sessions/receipt

### /finance

- /api/finance/pnl

### /finance/expenses

- /api/finance/expenses
- /api/finance/expenses/${id}

### /finance/purchases

- /api/finance/purchases
- /api/finance/purchases/${id}
- /api/inventory/items

### /find-id

- /api/auth/find-id

### /inventory

- /api/inventory/items
- /api/inventory/items/${item.id}
- /api/inventory/sales-trace
- /api/inventory/transactions

### /login

- /api/auth/login
- /api/auth/login/mfa
- /api/auth/login/otp/verify

### /m/monitor

- /api/auth/me
- /api/monitor/scope

### /m/monitor/store/[store_uuid]

- /api/auth/me

### /manager

- /api/attendance
- /api/auth/logout
- /api/auth/me
- /api/chat/unread
- /api/hostesses/unassigned
- /api/manager/bootstrap
- /api/manager/dashboard
- /api/manager/hostesses
- /api/manager/participants
- /api/manager/settlement/summary
- /api/manager/visibility
- /api/sessions/participants/${participantId}

### /manager/ledger

- /api/manager/ledger

### /manager/settlement

- /api/manager/settlement/summary

### /manager/settlement/[hostess_id]

- /api/manager/settlement/summary
- /api/sessions/participants/${participantId}
- /api/sessions/settlement
- /api/sessions/settlement/finalize

### /me

- /api/me/bootstrap

### /me/home

- /api/chat/rooms
- /api/me/home

### /me/security

- /api/auth/me
- /api/auth/mfa/disable
- /api/auth/mfa/enable
- /api/auth/mfa/recovery-codes
- /api/auth/mfa/setup

### /me/sessions/[session_id]

- /api/me/sessions/${sessionId}

### /me/settlements

- /api/me/settlements

### /operating-days

- /api/auth/reauth
- /api/operating-days/close
- /api/rooms

### /ops

- /api/store/service-types
- /api/store/settings

### /ops/attendance

- /api/ops/attendance-overview
- /api/store/staff

### /ops/errors

- /api/telemetry/errors
- /api/telemetry/errors/resolve

### /ops/issues

- /api/issues${qs}
- /api/issues/${id}

### /ops/watchdog

- /api/telemetry/test-alert
- /api/telemetry/watchdog

### /owner

- /api/attendance
- /api/auth/active-context
- /api/auth/logout
- /api/auth/memberships
- /api/auth/switch-membership
- /api/chat/unread
- /api/hostesses/unassigned
- /api/owner/bootstrap
- /api/store/profile
- /api/store/settlement/overview
- /api/store/staff
- /api/super-admin/stores-list

### /owner/accounts

- /api/owner/accounts
- /api/owner/accounts/${membershipId}
- /api/owner/accounts/${membershipId}/audit
- /api/owner/accounts/${selectedId}/${action}

### /owner/ble

- /api/ble/gateways
- /api/ble/gateways/${g.id}
- /api/ble/gateways/${g.id}/regenerate-secret
- /api/ble/gateways/${id}
- /api/ble/tags
- /api/ble/tags/${t.id}
- /api/ble/tags/discovered
- /api/rooms
- /api/store/staff

### /owner/labels

- /api/store/settings

### /owner/settlement

- /api/owner/settlement

### /payouts

- /api/auth/me
- /api/settlements/overview

### /payouts/cross-store

- /api/auth/me
- /api/cross-store
- /api/cross-store/${id}
- /api/cross-store/payout
- /api/store-managers
- /api/stores

### /payouts/hostesses

- /api/auth/me
- /api/settlement/payout
- /api/settlements/hostesses

### /payouts/managers

- /api/auth/me
- /api/settlement/payout
- /api/settlements/managers

### /payouts/settlement-tree

- /api/payouts/settlement-tree/confirm
- /api/settlements/staff-work-logs/aggregate

### /receipt

- /api/sessions/receipt

### /receipt/[snapshot_id]

- /api/sessions/receipt

### /reconcile

- /api/auth/me
- /api/reconcile/list
- /api/reconcile/upload

### /reconcile/[id]

- /api/reconcile/${id}
- /api/reconcile/${id}/diff
- /api/reconcile/${id}/edit
- /api/reconcile/${id}/extract
- /api/reconcile/${id}/review
- /api/store/staff

### /reconcile/setup

- /api/reconcile/format
- /api/store/settings/paper-ledger-retention

### /reconcile/staff

- /api/reconcile/list
- /api/reconcile/upload

### /reports

- /api/operating-days/close
- /api/operating-days/reopen
- /api/reports/daily
- /api/reports/hostess
- /api/reports/manager
- /api/rooms

### /reports/overview

- /api/reports/activity
- /api/reports/cross-store
- /api/reports/hostesses
- /api/reports/managers
- /api/reports/overview

### /reports/period

- /api/reports/period

### /reset-password

- /api/auth/change-password
- /api/auth/logout
- /api/auth/reset-password

### /settlement

- /api/auth/me
- /api/manager/settlement/summary
- /api/me/settlement-status
- /api/store/settlement/overview

### /settlement/history

- /api/settlement/history

### /signup

- /api/auth/signup

### /staff

- /api/me/preferences
- /api/store/settings
- /api/store/staff
- /api/store/staff/analytics

### /staff-board

- /api/notifications/preferences
- /api/staff-board
- /api/staff-board/${id}
- /api/staff-board/${target.id}/respond

### /super-admin

- /api/super-admin/dashboard

### /super-admin/location-corrections

- /api/location/corrections/by-user
- /api/monitor/movement/${encodeURIComponent(mvMemId.trim())}
- /api/monitor/scope
- /api/monitor/stores

### /super-admin/stores/[store_uuid]

- /api/super-admin/stores/${store_uuid}
- /api/super-admin/stores/${store_uuid}/settlement/manager
- /api/super-admin/stores/${store_uuid}/settlement/owner

### /super-admin/visualize/money

- /api/super-admin/dashboard

### /super-admin/visualize/network

- /api/super-admin/dashboard

### /transfer

- /api/transfer/approve
- /api/transfer/cancel
- /api/transfer/list

### assign-session.html

- /api/auth/me
- /api/manager/hostesses
- /api/rooms
- /api/sessions/checkin
- /api/sessions/participants
- /api/store/service-types

### chat-room.html

- /api/auth/me
- /api/building/hostesses
- /api/building/stores

### index.html

- /api/auth/me
- /api/manager/hostesses

### me.html

- /api/auth/logout
- /api/auth/me
- /api/auth/memberships
- /api/manager/hostesses

### staff-list.html

- /api/auth/me
- /api/manager/hostesses

### staff.html

- /api/auth/me
- /api/manager/hostesses

## API endpoint 사용처 (역방향)

### /api/admin/dashboard

- /admin

### /api/admin/deployments

- /admin/deployments

### /api/admin/members/create

- /admin/members/create

### /api/admin/members/invite 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/admin/preferences 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/attendance

- /attendance
- /manager
- /owner

### /api/audit

- /audit

### /api/audit-events

- /audit-events

### /api/auth/active-context

- /owner

### /api/auth/change-password

- /reset-password

### /api/auth/devices 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/auth/devices/revoke 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/auth/find-id

- /find-id

### /api/auth/login

- /login

### /api/auth/login/mfa

- /login

### /api/auth/login/otp/verify

- /login

### /api/auth/logout

- me.html
- /cafe/manage
- /manager
- /owner
- /reset-password

### /api/auth/me

- assign-session.html
- chat-room.html
- index.html
- me.html
- staff-list.html
- staff.html
- /m/monitor
- /m/monitor/store/[store_uuid]
- /manager
- /me/security
- /payouts
- /payouts/cross-store
- /payouts/hostesses
- /payouts/managers
- /reconcile
- /settlement

### /api/auth/memberships

- me.html
- /owner

### /api/auth/mfa/disable

- /me/security

### /api/auth/mfa/enable

- /me/security

### /api/auth/mfa/recovery-codes

- /me/security

### /api/auth/mfa/setup

- /me/security

### /api/auth/mfa/verify 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/auth/realtime-token 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/auth/reauth

- /operating-days

### /api/auth/refresh 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/auth/reset-password

- /reset-password

### /api/auth/signup

- /signup

### /api/auth/switch-membership

- /owner

### /api/ble/corrections 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/ble/feedback 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/ble/feedback/kpi 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/ble/gateways

- /owner/ble

### /api/ble/gateways/[id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/ble/gateways/[id]/regenerate-secret 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/ble/gateways/${g.id}

- /owner/ble

### /api/ble/gateways/${g.id}/regenerate-secret

- /owner/ble

### /api/ble/gateways/${id}

- /owner/ble

### /api/ble/ingest 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/ble/presence

- /ble

### /api/ble/tags

- /owner/ble

### /api/ble/tags/[id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/ble/tags/${t.id}

- /owner/ble

### /api/ble/tags/discovered

- /owner/ble

### /api/building/hostesses

- chat-room.html

### /api/building/stores

- chat-room.html

### /api/cafe/account

- /cafe/manage/account

### /api/cafe/admin/overview

- /cafe/admin

### /api/cafe/credits

- /cafe/manage/inbox

### /api/cafe/credits/[id]/pay 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cafe/credits/${id}/pay

- /cafe/manage/credits

### /api/cafe/credits${unpaidOnly

- /cafe/manage/credits

### /api/cafe/finance

- /cafe/manage/finance

### /api/cafe/manage/bootstrap 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cafe/menu

- /cafe/manage/menu

### /api/cafe/menu/[id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cafe/menu/[id]/detail 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cafe/menu/[id]/options 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cafe/menu/[id]/options/[group_id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cafe/menu/[id]/recipes 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cafe/menu/${id}

- /cafe/manage/menu

### /api/cafe/menu/${id}/recipes

- /cafe/manage/pos

### /api/cafe/menu/${newId}/options

- /cafe/manage/menu

### /api/cafe/menu/${newId}/recipes

- /cafe/manage/menu

### /api/cafe/orders 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cafe/orders/[id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cafe/orders/${id}

- /cafe/manage/inbox

### /api/cafe/orders/inbox

- /cafe/admin/[store_uuid]/inbox
- /cafe/manage/inbox
- /cafe/manage/pos

### /api/cafe/reviews 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cafe/storefront/[store_uuid] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cafe/storefront/${storeId}

- /cafe/[store_uuid]

### /api/cafe/stores

- /cafe/admin/[store_uuid]/inbox

### /api/cafe/supplies

- /cafe/manage/menu
- /cafe/manage/store

### /api/cafe/supplies/[id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cafe/supplies/${adjustFor}

- /cafe/manage/store

### /api/cafe/supplies/${id}

- /cafe/manage/store

### /api/cafe/supplies/purchases

- /cafe/manage/store

### /api/cafe/upload

- /cafe/manage/menu

### /api/chat/messages 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/chat/rooms

- /me/home

### /api/chat/rooms/[id]/close 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/chat/rooms/[id]/leave 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/chat/rooms/[id]/participants 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/chat/rooms/[id]/pin 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/chat/rooms/[id]/read 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/chat/unread

- /manager
- /owner

### /api/counter/bootstrap 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/counter/monitor 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/credits

- /credits

### /api/credits/[credit_id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/credits/${creditId}

- /credits

### /api/cron/audit-archive 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cron/ble-attendance-sync 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cron/ble-history-reaper 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cron/ble-session-inference 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cron/ops-alerts-scan 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cron/paper-ledger-expire 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cron/settlement-tree-advance 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cron/system-errors-cleanup 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cron/watchdog 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cross-store

- /payouts/cross-store

### /api/cross-store/[id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cross-store/${id}

- /payouts/cross-store

### /api/cross-store/approve 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cross-store/payout

- /payouts/cross-store

### /api/cross-store/payout/cancel 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cross-store/records 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cross-store/settlement 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/cross-store/work-record 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/customers

- /customers

### /api/customers/[customer_id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/customers/[customer_id]/merge 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/customers/${customer_id}

- /customers/[customer_id]

### /api/finance/expenses

- /finance/expenses

### /api/finance/expenses/[id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/finance/expenses/${id}

- /finance/expenses

### /api/finance/pnl

- /finance

### /api/finance/purchases

- /finance/purchases

### /api/finance/purchases/[id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/finance/purchases/${id}

- /finance/purchases

### /api/health 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/hostesses/[membership_id]/assign 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/hostesses/unassigned

- /manager
- /owner

### /api/inventory/items

- /finance/purchases
- /inventory

### /api/inventory/items/[item_id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/inventory/items/${item.id}

- /inventory

### /api/inventory/sales-trace

- /inventory

### /api/inventory/transactions

- /inventory

### /api/issues 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/issues/[id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/issues/${id}

- /ops/issues

### /api/issues${qs}

- /ops/issues

### /api/learn/export 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/learn/stats

- /admin/learn

### /api/location/correct 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/location/corrections/by-user

- /admin/location-corrections
- /super-admin/location-corrections

### /api/location/corrections/daily-summary 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/location/corrections/overview 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/manager-permissions/grant 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/manager-permissions/revoke 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/manager/bootstrap

- /manager

### /api/manager/dashboard

- /manager

### /api/manager/hostess-stats 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/manager/hostesses

- assign-session.html
- index.html
- me.html
- staff-list.html
- staff.html
- /manager

### /api/manager/hostesses/[hostess_id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/manager/hostesses/[hostess_id]/sessions 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/manager/ledger

- /manager/ledger

### /api/manager/participants

- /manager

### /api/manager/settlement/summary

- /manager
- /manager/settlement
- /manager/settlement/[hostess_id]
- /settlement

### /api/manager/visibility

- /manager

### /api/me/accounts 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/me/accounts/[id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/me/attendance 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/me/bank-accounts 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/me/bootstrap

- /me

### /api/me/dashboard 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/me/home

- /me/home

### /api/me/menu-permissions 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/me/payees 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/me/payees/[id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/me/preferences

- /staff

### /api/me/sessions 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/me/sessions/[session_id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/me/sessions/${sessionId}

- /me/sessions/[session_id]

### /api/me/settlement-status

- /settlement

### /api/me/settlements

- /me/settlements

### /api/monitor/movement/[membership_id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/monitor/movement/${encodeURIComponent(mvMemId.trim())}

- /super-admin/location-corrections

### /api/monitor/scope

- /m/monitor
- /super-admin/location-corrections

### /api/monitor/stores

- /super-admin/location-corrections

### /api/notifications/preferences

- /staff-board

### /api/operating-days/close

- /operating-days
- /reports

### /api/operating-days/reopen

- /reports

### /api/operating-days/snapshot 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/operating-days/status 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/ops/apply-recovery/stale-pending 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/ops/attendance-overview

- /ops/attendance

### /api/ops/ble-analytics/floor-map 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/ops/ble-analytics/gateways 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/ops/ble-analytics/logs 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/ops/ble-analytics/overview 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/ops/ble-analytics/timeline 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/ops/ble-analytics/transitions 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/owner/accounts

- /owner/accounts

### /api/owner/accounts/[membership_id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/owner/accounts/[membership_id]/approve 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/owner/accounts/[membership_id]/audit 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/owner/accounts/[membership_id]/reject 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/owner/accounts/[membership_id]/reset-password 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/owner/accounts/[membership_id]/suspend 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/owner/accounts/${membershipId}

- /owner/accounts

### /api/owner/accounts/${membershipId}/audit

- /owner/accounts

### /api/owner/accounts/${selectedId}/${action}

- /owner/accounts

### /api/owner/bootstrap

- /owner

### /api/owner/settlement

- /owner/settlement

### /api/payouts/cross-store-items 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/payouts/cross-store-items/[item_id]/assign-manager 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/payouts/cross-store-items/[item_id]/handover 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/payouts/cross-store-items/[item_id]/release 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/payouts/manager-prepayment 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/payouts/settlement-tree/confirm

- /payouts/settlement-tree

### /api/payouts/settlement-tree/store 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/reconcile/[id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/reconcile/[id]/diff 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/reconcile/[id]/edit 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/reconcile/[id]/extract 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/reconcile/[id]/parse-text 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/reconcile/[id]/review 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/reconcile/${id}

- /reconcile/[id]

### /api/reconcile/${id}/diff

- /reconcile/[id]

### /api/reconcile/${id}/edit

- /reconcile/[id]

### /api/reconcile/${id}/extract

- /reconcile/[id]

### /api/reconcile/${id}/review

- /reconcile/[id]

### /api/reconcile/format

- /reconcile/setup

### /api/reconcile/grants

- /admin/reconcile-grants

### /api/reconcile/grants/[id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/reconcile/grants/${id}

- /admin/reconcile-grants

### /api/reconcile/learn

- /admin/reconcile-grants

### /api/reconcile/list

- /reconcile
- /reconcile/staff

### /api/reconcile/upload

- /reconcile
- /reconcile/staff

### /api/reports/activity

- /reports/overview

### /api/reports/cross-store

- /reports/overview

### /api/reports/daily

- /reports

### /api/reports/daily/breakdown 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/reports/hostess

- /reports

### /api/reports/hostesses

- /reports/overview

### /api/reports/liquor-target 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/reports/manager

- /reports

### /api/reports/managers

- /reports/overview

### /api/reports/overview

- /reports/overview

### /api/reports/period

- /reports/period

### /api/reports/settlement-tree 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/reports/settlement-tree-operational 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/rooms

- assign-session.html
- /counter/[room_id]/bill
- /counter/[room_id]/payment
- /counter/[room_id]/pre-settlement
- /credits
- /operating-days
- /owner/ble
- /reports

### /api/rooms/[room_uuid] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/rooms/[room_uuid]/participants 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/rooms/${roomId}

- /counter/[room_id]/checkin

### /api/rooms/${roomId}/participants

- /counter/[room_id]/checkout

### /api/rooms/for-work-log 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/session-participant-actions/[action_id]/apply 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/session-participant-actions/[action_id]/retry 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/[session_id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/[session_id]/settlement 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/[session_id]/settlement/confirm 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/[session_id]/settlement/pay 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/[session_id]/settlement/payout 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/[session_id]/settlement/recalculate 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/bill

- /counter/[room_id]/bill

### /api/sessions/checkin

- assign-session.html
- /counter/[room_id]/checkin

### /api/sessions/checkout

- /counter/[room_id]/checkout

### /api/sessions/extend 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/for-work-log 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/mid-out 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/orders 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/orders/[order_id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/participants

- assign-session.html
- /counter/[room_id]/checkin

### /api/sessions/participants/[participant_id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/participants/${p.id}

- /counter/[room_id]/checkout

### /api/sessions/participants/${participantId}

- /manager
- /manager/settlement/[hostess_id]

### /api/sessions/participants/actions 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/participants/apply-actions 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/participants/batch

- /counter/[room_id]/checkin

### /api/sessions/pre-settlement

- /counter/[room_id]/pre-settlement

### /api/sessions/receipt

- /customers/[customer_id]/receipt/[snapshot_id]
- /receipt
- /receipt/[snapshot_id]

### /api/sessions/receipt/archive 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/reopen 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/sessions/settlement

- /counter/[room_id]/checkout
- /manager/settlement/[hostess_id]

### /api/sessions/settlement/finalize

- /manager/settlement/[hostess_id]

### /api/sessions/settlement/payment

- /counter/[room_id]/payment

### /api/settlement/history

- /settlement/history

### /api/settlement/payout

- /payouts/hostesses
- /payouts/managers

### /api/settlement/payout/cancel 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/settlement/payouts 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/settlements/hostesses

- /payouts/hostesses

### /api/settlements/managers

- /payouts/managers

### /api/settlements/overview

- /payouts

### /api/settlements/staff-work-logs/aggregate

- /payouts/settlement-tree

### /api/staff-board

- /staff-board

### /api/staff-board/[id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/staff-board/[id]/respond 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/staff-board/${id}

- /staff-board

### /api/staff-board/${target.id}/respond

- /staff-board

### /api/staff-work-logs 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/staff-work-logs/[id]/confirm 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/staff-work-logs/[id]/dispute 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/staff-work-logs/[id]/resolve 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/staff-work-logs/[id]/void 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/store-managers

- /payouts/cross-store

### /api/store/approvals

- /admin/approvals

### /api/store/managers/[membership_id]/menu-permissions 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/store/profile

- /owner

### /api/store/service-types

- assign-session.html
- /ops

### /api/store/settings

- /counter/[room_id]/payment
- /ops
- /owner/labels
- /staff

### /api/store/settings/paper-ledger-retention

- /reconcile/setup

### /api/store/settlement/overview

- /owner
- /settlement

### /api/store/staff

- /admin/reconcile-grants
- /counter/[room_id]/checkin
- /counter/[room_id]/pre-settlement
- /credits
- /ops/attendance
- /owner
- /owner/ble
- /reconcile/[id]
- /staff

### /api/store/staff/analytics

- /staff

### /api/stores

- /payouts/cross-store

### /api/super-admin/dashboard

- /super-admin
- /super-admin/visualize/money
- /super-admin/visualize/network

### /api/super-admin/stores-list

- /owner

### /api/super-admin/stores/[store_uuid] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/super-admin/stores/[store_uuid]/sessions/[session_id]/force-close 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/super-admin/stores/[store_uuid]/sessions/[session_id]/override-price 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/super-admin/stores/[store_uuid]/sessions/[session_id]/participants/[participant_id]/force-leave 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/super-admin/stores/[store_uuid]/sessions/[session_id]/participants/force-clean 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/super-admin/stores/[store_uuid]/sessions/[session_id]/recover 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/super-admin/stores/[store_uuid]/settlement/manager 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/super-admin/stores/[store_uuid]/settlement/owner 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/super-admin/stores/${store_uuid}

- /super-admin/stores/[store_uuid]

### /api/super-admin/stores/${store_uuid}/settlement/manager

- /super-admin/stores/[store_uuid]

### /api/super-admin/stores/${store_uuid}/settlement/owner

- /super-admin/stores/[store_uuid]

### /api/super-admin/visualize/flow/money 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/super-admin/visualize/graph/network 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/super-admin/visualize/graph/node/[type]/[id] 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/super-admin/visualize/operating-days 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/system/time 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/system/version 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/system/warmup 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/telemetry/capture 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

### /api/telemetry/errors

- /ops/errors

### /api/telemetry/errors/resolve

- /ops/errors

### /api/telemetry/test-alert

- /ops/watchdog

### /api/telemetry/watchdog

- /ops/watchdog

### /api/transfer/approve

- /transfer

### /api/transfer/cancel

- /transfer

### /api/transfer/list

- /transfer

### /api/transfer/request 🔵

호출 페이지 없음 (cron / 내부 / 미사용)

