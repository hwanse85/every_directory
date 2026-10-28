// E2E 동안 macOS 클립보드의 모든 항목·형식을 메모리에만 보관했다가 그대로 되돌린다.
// 보호 절차는 Windows clipboard-guard.ps1과 같다: READY 출력 → 표준 입력 한 줄 대기 → 복원 후 RESTORED 출력.
import AppKit

let board = NSPasteboard.general
var saved: [[(NSPasteboard.PasteboardType, Data)]] = []
for item in board.pasteboardItems ?? [] {
    var formats: [(NSPasteboard.PasteboardType, Data)] = []
    for type in item.types {
        // 지연 제공 형식처럼 읽을 수 없는 데이터가 있으면 원래 내용을 지킬 수 없으므로 중단한다.
        guard let data = item.data(forType: type) else {
            print("ED_CLIPBOARD_SKIP")
            exit(2)
        }
        formats.append((type, data))
    }
    saved.append(formats)
}
print("ED_CLIPBOARD_READY")
fflush(stdout)
_ = readLine()
board.clearContents()
if !saved.isEmpty {
    let items = saved.map { formats -> NSPasteboardItem in
        let item = NSPasteboardItem()
        for (type, data) in formats { item.setData(data, forType: type) }
        return item
    }
    if !board.writeObjects(items) {
        print("ED_CLIPBOARD_FAILED")
        exit(3)
    }
}
print("ED_CLIPBOARD_RESTORED")
