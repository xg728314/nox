import { parseStaffChat } from "../app/counter/helpers/staffChatParser.ts"
console.log("=== TEST 1: '1번방 신 지수 황 미연 퍼 완메' ===")
console.log(JSON.stringify(parseStaffChat("1번방 신 지수 황 미연 퍼 완메"), null, 2))
console.log("\n=== TEST 2: '3번방 라 보영 셔 반티' ===")
console.log(JSON.stringify(parseStaffChat("3번방 라 보영 셔 반티"), null, 2))
console.log("\n=== TEST 3: 'R5 마 채린 하 차3' ===")
console.log(JSON.stringify(parseStaffChat("R5 마 채린 하 차3"), null, 2))
console.log("\n=== TEST 4: '신 지수 퍼 완메' (방번호 없음) ===")
console.log(JSON.stringify(parseStaffChat("신 지수 퍼 완메"), null, 2))
