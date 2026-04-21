"use client"

/**
 * /counter/monitor — standalone full-page variant.
 *
 * Body moved into ./MonitorPanel.tsx so the same implementation can be
 * mounted inside /counter as an embedded panel. This route keeps the
 * full-viewport chrome (MonitorHeader, BottomNavStrip, ModeHelpStrip).
 * Changes in this file alone should be extremely rare — edit
 * MonitorPanel.tsx for anything substantive.
 */

import MonitorPanel from "./MonitorPanel"

export default function CounterMonitorPage() {
  return <MonitorPanel variant="page" />
}
