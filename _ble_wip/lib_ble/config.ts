export const BLE_SOURCE: "DEV" | "REAL" = 
  process.env.NEXT_PUBLIC_BLE_SOURCE === "REAL" ? "REAL" : "DEV";
