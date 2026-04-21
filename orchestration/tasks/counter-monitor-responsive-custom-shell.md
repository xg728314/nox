You are working in the active NOX workspace:

C:\work\nox

This round is a RESPONSIVE + CUSTOMIZABLE MONITOR SHELL round for the already-implemented /counter/monitor screen.

This is NOT a rewrite.
This is NOT a transactional counter replacement round.
This is the layout-control foundation round that must come BEFORE making /counter/monitor the default operating surface.

==================================================
[OBJECTIVE]
==================================================

Upgrade /counter/monitor into a responsive, multi-device, customizable monitor shell that works across:

- PC
- tablet
- mobile

The monitor must remain additive and safe.

The most important requirement is:
operators must be able to hide/show the minimap and adapt the layout depending on device and working style.

Examples:
- on phone: rooms-first view, map hidden by default
- on tablet: map toggleable
- on desktop: full monitor layout by default
- users must be able to collapse the minimap and focus on the left room list
- reopening the minimap must restore the monitor layout cleanly

==================================================
[CURRENT STATE — MUST PRESERVE]
==================================================

Already implemented and must remain intact:
- /counter transactional workflow remains untouched
- /counter/monitor exists and is the monitoring UI
- /api/counter/monitor already provides derived data
- BLE overlay is read-only only
- no BLE trust is allowed
- no session/participant/settlement mutation is tied to BLE
- existing monitor UI structure must remain recognizable
- server-side visibility policy remains authoritative

Do NOT weaken any of this.

==================================================
[PRIMARY GOALS]
==================================================

Implement these in order:

1. RESPONSIVE LAYOUT MODES
2. MINIMAP COLLAPSE / EXPAND
3. MONITOR LAYOUT PREFERENCES
4. PANEL VISIBILITY CONTROL
5. DEVICE-SAFE DEFAULTS

==================================================
[DETAILED REQUIREMENTS]
==================================================

----------------------------------
1. RESPONSIVE LAYOUT MODES
----------------------------------

Create responsive layout behavior for /counter/monitor.

Desktop:
- keep the current 3-column monitor layout
- left: room list
- center: minimap + feed
- right: side panels

Tablet:
- reduce to 2-column-friendly layout
- room list + center content remain primary
- right-side info panels may stack below or become a tab/drawer region
- minimap still available

Mobile:
- default to room-focused mode
- minimap hidden/collapsed by default
- allow quick switch between:
  - rooms
  - map
  - alerts
  - home workers / location status
- do NOT try to squeeze desktop 3-column layout into mobile width

This must be a true responsive layout strategy, not just CSS shrinking.

----------------------------------
2. MINIMAP COLLAPSE / EXPAND
----------------------------------

Add a clear UI control to collapse/expand the minimap region.

Behavior:
- when collapsed:
  - the center minimap region is hidden
  - the screen prioritizes room list and other key operational panels
- when expanded:
  - the current monitor layout returns cleanly
- this should feel like an operator workspace toggle, not a hack

This is required because operators may want:
- room-only focus
- full monitor mode
- smaller devices to avoid map clutter

----------------------------------
3. MONITOR LAYOUT PREFERENCES
----------------------------------

Integrate monitor layout preferences into the existing preference/customization system.

Reuse the current preference architecture if possible.
Do NOT invent a separate ad-hoc local-only persistence model unless absolutely necessary.

Preferred new scopes (or equivalent if your existing naming conventions differ):
- counter.monitor_layout
- counter.monitor_panels
- counter.monitor_density

At minimum persist:
- minimap collapsed/expanded
- selected default monitor mode per device class if feasible
- visible panels preference (e.g. right column shown/hidden where appropriate)

Use the existing:
- user preference flow
- shared propagation approach
- store/global override model if it naturally fits
- current preference safety rules

This round is about monitor layout preferences, not transactional preferences.

----------------------------------
4. PANEL VISIBILITY CONTROL
----------------------------------

Allow safe show/hide or collapse behavior for major monitor regions where appropriate.

Examples:
- minimap collapsed
- right panel collapsed on smaller screens
- movement feed moved below on tablet/mobile
- room list remains the highest-priority visible region

Do NOT allow hiding the room list entirely by default on mobile.
The room list is the primary operational fallback surface.

----------------------------------
5. DEVICE-SAFE DEFAULTS
----------------------------------

Default layout expectations:

Desktop:
- full monitor expanded

Tablet:
- monitor expanded but compact

Mobile:
- rooms-first
- minimap collapsed by default
- side panels accessible via tabs/sections/drawer

Make these defaults sensible even before the user customizes anything.

==================================================
[IMPORTANT PRODUCT RULES]
==================================================

1. Existing /counter must remain intact
2. Existing /counter/monitor data flow must remain intact
3. BLE remains read-only overlay only
4. This round must NOT absorb transactional counter actions yet
5. This round must prepare the shell for future absorption of counter actions later
6. Do NOT redesign auth, monitor API contracts, or BLE ingest
7. Do NOT remove the current monitor UI structure
8. Reuse current customization/preference architecture where feasible
9. Keep server-side policy as source of truth
10. The room list must remain the most reliable operational region

==================================================
[WHAT THIS ROUND IS NOT]
==================================================

Do NOT do these in this round:
- do NOT move checkin/order/calculate/checkout into monitor yet
- do NOT make /counter/monitor the default entry yet
- do NOT replace /counter
- do NOT connect BLE to business writes
- do NOT redesign the whole monitor visually
- do NOT rewrite the monitor API unless required for preference-safe layout support

==================================================
[IMPLEMENTATION GUIDANCE]
==================================================

Before coding, inspect and reuse:

- /counter/monitor current page and components
- existing preference/customization architecture
- preferencesStore
- useRoomLayout
- useMenuConfig
- current user preference endpoints
- any relevant existing layout/customization helpers

If monitor-specific preference helpers are needed:
- keep them additive
- keep naming consistent
- do not damage the existing counter customization system

If a new preferences scope is required, implement it cleanly and safely.

==================================================
[UX INTENT]
==================================================

The operator should be able to do this naturally:

- On PC: open full monitor and use everything
- On tablet: hide/show map quickly depending on situation
- On phone: focus on room list first, then open map only when needed
- Return to their preferred layout automatically next time

This must feel like a professional adaptable operating surface.

==================================================
[OUTPUT FORMAT]
==================================================

Return ONLY in this format:

1. FILES CHANGED
- exact paths
- new vs modified

2. RESPONSIVE / LAYOUT SUMMARY
- what changed for desktop
- what changed for tablet
- what changed for mobile

3. MINIMAP TOGGLE BEHAVIOR
- how collapse/expand works
- how layout reflows

4. PREFERENCE INTEGRATION
- what monitor layout preferences are stored
- where they are stored
- what existing architecture was reused

5. SAFETY / NON-CHANGES
- what was intentionally not touched
- confirm /counter remains intact
- confirm BLE remains read-only
- confirm no transactional absorption yet

6. VALIDATION
- typecheck
- build
- manual verification steps

7. NEXT BEST STEP
- the next round after this one only

==================================================
[FINAL EXECUTION INSTRUCTION]
==================================================

Understand the existing /counter/monitor and current customization/preference system first.
Then implement a responsive customizable monitor shell additively and safely.
No broad rewrites.
No guessing.
Do not touch transactional flows.