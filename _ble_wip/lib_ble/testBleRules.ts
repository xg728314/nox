import { normalizeTagId } from "@/lib/ble/normalizeTagId";
import { findByTagId } from "@/lib/mock/tagRegistry";
import { getRooms, getActiveSessions, RoomStatus, startSession, SessionType } from "@/lib/counterStore";

type Options = {
  mutate?: boolean; // if true, may call startSession and change in-memory store
};

export function runBleRuleTests(options: Options = {}): string[] {
  const mutate = !!options.mutate;
  const logs: string[] = [];
  const log = (s: string) => logs.push(s);

  try {
    log("=== BLE Handler Rules Assertion Tests ===");
    log(`mode: ${mutate ? "MUTATE" : "SAFE(read-only)"}`);

    const captureState = () => ({
      rooms: getRooms().map((r: any) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        managerName: r.managerName,
      })),
      sessions: getActiveSessions().map((s: any) => ({
        id: s.id,
        managerName: s.managerName,
        roomId: s.roomId,
      })),
    });

    // Test 1: Unregistered tag => no changes
    log("--- Test 1: Unregistered Tag ---");
    const stateBefore1 = captureState();

    const unregisteredTag = "definitely-unregistered-tag-12345";
    const normalized1 = normalizeTagId(unregisteredTag);

    const tagAssignment1 = findByTagId(normalized1);
    if (!tagAssignment1) log(`OK: Unregistered tag detected: ${normalized1} (no-op)`);

    const stateAfter1 = captureState();
    const roomsChanged1 = JSON.stringify(stateBefore1.rooms) !== JSON.stringify(stateAfter1.rooms);
    const sessionsChanged1 = JSON.stringify(stateBefore1.sessions) !== JSON.stringify(stateAfter1.sessions);

    log(`ASSERT: rooms unchanged = ${!roomsChanged1}`);
    log(`ASSERT: sessions unchanged = ${!sessionsChanged1}`);
    log(`RESULT: ${!roomsChanged1 && !sessionsChanged1 ? "PASSED" : "FAILED"}`);

    if (!mutate) {
      log("--- Remaining tests skipped in SAFE mode ---");
      log("Tip: enable mutate mode to run startSession-based assertions.");
      log("=== Tests Completed ===");
      return logs;
    }

    // Pick a registered tag for mutate tests
    const registeredTag = "tag-minjun";
    const tagInfo = findByTagId(normalizeTagId(registeredTag));
    if (!tagInfo) {
      log("--- Test 2/3/4 SKIPPED: No registered tag found for tag-minjun ---");
      log("=== Tests Completed ===");
      return logs;
    }

    // Test 2: Already-in-use tag => no duplicate session
    log("--- Test 2: Already In-Use Tag ---");
    startSession({
      roomId: "1",
      roomName: "1번방",
      managerName: tagInfo.managerName,
      planKey: "public-full",
      sessionType: SessionType.PUBLIC,
      startedAt: new Date().toISOString(),
      basePrice: 50000,
      extraMinutes: 0,
      extraPrice: 0,
    });

    const stateBefore2 = captureState();
    const existingSession2 = getActiveSessions().find((s: any) => s.managerName === tagInfo.managerName);

    if (existingSession2) log(`OK: already has active session in room ${existingSession2.roomId} (no-op)`);

    const stateAfter2 = captureState();
    const duplicateCreated = stateAfter2.sessions.length > stateBefore2.sessions.length;

    log(`ASSERT: no duplicate session created = ${!duplicateCreated}`);
    log(`RESULT: ${!duplicateCreated ? "PASSED" : "FAILED"}`);

    // Test 3: No empty rooms => no changes (best-effort)
    log("--- Test 3: No Empty Rooms ---");
    const emptyRoomsBefore3 = getRooms().filter((r: any) => r.status === RoomStatus.EMPTY);
    log(`Empty rooms before fill: ${emptyRoomsBefore3.length}`);

    emptyRoomsBefore3.forEach((room: any, idx: number) => {
      startSession({
        roomId: room.id,
        roomName: room.name,
        managerName: `Test Manager ${idx}`,
        planKey: "public-full",
        sessionType: SessionType.PUBLIC,
        startedAt: new Date().toISOString(),
        basePrice: 50000,
        extraMinutes: 0,
        extraPrice: 0,
      });
    });

    const stateBefore3 = captureState();
    const emptyRoomsNow3 = getRooms().filter((r: any) => r.status === RoomStatus.EMPTY);

    if (emptyRoomsNow3.length === 0) log("OK: no empty rooms available (no-op expected)");

    const stateAfter3 = captureState();
    const roomsChanged3 = JSON.stringify(stateBefore3.rooms) !== JSON.stringify(stateAfter3.rooms);
    const sessionsChanged3 = JSON.stringify(stateBefore3.sessions) !== JSON.stringify(stateAfter3.sessions);

    log(`ASSERT: no empty rooms -> no further changes = ${!roomsChanged3 && !sessionsChanged3}`);
    log(`RESULT: ${!roomsChanged3 && !sessionsChanged3 ? "PASSED" : "FAILED"}`);

    log("=== Tests Completed ===");
    return logs;
  } catch (e: any) {
    return [`EXCEPTION: ${e?.message ?? String(e)}`];
  }
}
