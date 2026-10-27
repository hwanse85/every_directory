# Windows 기본 ‘새로 만들기’ — 0.9.1

탐색창의 **우클릭 → 새로 만들기**를 클릭하면 Windows의 실제 새로 만들기 메뉴가 열립니다. 파일 형식 목록을 앱에 고정하지 않고, 현재 사용자 PC의 Windows Shell 등록 정보를 사용합니다.

## 사용 방법과 동작

- 탐색창의 현재 폴더에서 우클릭하고 **새로 만들기**를 클릭합니다. Windows 메뉴에서 원하는 형식을 선택합니다.
- 설치된 프로그램이 등록한 문서 형식·서식·생성 마법사를 Windows가 실행합니다. 설치만 되어 있고 ‘새로 만들기’에 등록되지 않은 형식은 표시되지 않을 수 있습니다. 기본 Windows 탐색기에서도 동일한 등록 조건을 사용합니다.
- 실행한 탐색창의 현재 탭·현재 폴더에 생성합니다. 새 파일이 즉시 생성되면 목록을 갱신하고 선택합니다. **F2**로 이름을 변경할 수 있습니다. 마법사를 통한 지연 생성은 파일 감시로 갱신합니다.
- 기본 이름과 중복 이름 처리는 Windows가 담당합니다. 메뉴를 취소하면 생성하지 않습니다.
- ‘새로 만들기’에 마우스를 올리거나 → 키로 하위 메뉴를 열면 기존 새 폴더·새 텍스트 파일 단축 메뉴도 이용할 수 있습니다. 이 하위 메뉴의 **Windows 새로 만들기…** 항목에서도 시스템 메뉴를 열 수 있습니다.
- Windows 이외의 환경과 웹 실행에서는 기존 생성 메뉴를 유지합니다.

## 구현 범위

Windows의 `CLSID_NewMenu`, `IShellExtInit`, `IContextMenu`를 사용합니다. STA 스레드에 메뉴용 창을 만들고 `IContextMenu2/3` 메시지를 전달해 동적·아이콘 메뉴를 처리합니다. UI 화면 좌표는 배율을 반영해 Windows 클라이언트 좌표로 변환합니다.

앱이 레지스트리를 수정하거나 확장자만 바꾼 가짜 문서를 만들지 않습니다. `NullFile`, `FileName`, `Data`, `Command` 중 등록된 생성 방식을 Windows가 선택합니다. **일부 형식은 정상적인 Windows 등록에 따라 빈 파일로 생성됩니다.** 이를 임의로 변경하지 않습니다. 이 기능은 새로 만들기 메뉴를 연결한 것이며, 전체 Windows 탐색기를 내장하는 변경은 아닙니다.

연결된 폴더 범위와 대상 폴더를 검증하며, 메뉴를 연 뒤 대상 위치가 바뀌면 작업을 거부합니다. 메뉴가 열려 있는 동안 파일 작업 잠금을 잡지 않습니다. 생성 후 새 항목만 인덱스에 반영하며 기존 폴더 전체를 다시 검색하지 않습니다.

## 검증

Windows 11의 실제 Tauri/WebView2 앱에서 시스템 메뉴 표시·취소, 텍스트 생성, 중복 생성 시 기존 파일 보존, 생성 후 선택과 F2, 폴더 생성, 설치된 Excel 서식 생성, 두 번째 탐색창의 대상 폴더, 잘못된 경로·좌표 거부를 검증했습니다. 자동화는 실제 네이티브 메뉴 열기·취소와, 검증 전용 빌드에서 실제 Shell 명령을 선택하는 방식으로 구분됩니다. 검증 훅은 배포 빌드에서 제외합니다.

네이티브 Rust 검증에서는 이 PC의 등록 목록 12개를 확인했고, 등록된 폴더·TXT·BMP·DOCX·XLSX·PPTX·HWPX 생성 명령을 실행했습니다. XLSX는 실제 ZIP 문서 서식으로 생성됨을 확인했습니다. 설치 프로그램과 파일 연결 상태가 다른 모든 PC, 모든 서드파티 생성 마법사, Windows 10 실기기 동작까지 검증한 것은 아닙니다.

전체 회귀 검증은 Windows 네이티브 E2E **16개 묶음·260개 항목**(건너뛴 묶음 없음), TypeScript/웹 서비스 **65개**, Rust **62개**가 통과했습니다. Rust 62개에는 새 Windows 메뉴 검증 3개가 포함됩니다. 선택 실행하는 성능·볼륨 검증 5개와 별도 대용량 분석 검증 1개는 이 변경에서 재실행하지 않았습니다.

## English

Right-click in an explorer pane and click **New** to open the real Windows Shell New menu. Available types follow the current PC’s Shell registrations. Windows handles templates, creation wizards and duplicate names. Newly created files are selected when available; press **F2** to rename. Hovering the parent item retains the existing quick folder/text submenu, including an entry to open the native menu.

Creation targets the current folder of the initiating pane. Registered roots and destination paths are validated. The application does not modify Shell registrations or fabricate document contents. A registered `NullFile` type can legitimately create an empty file. This integrates the native New menu; it does not embed the entire Windows Explorer.

Verified on Windows 11 using native COM handlers and a real Tauri/WebView2 app. Physical Windows 10 and every third-party Shell extension have not been tested.

## Microsoft 문서

- [Extending the New Submenu — ShellNew 등록과 생성 방식](https://learn.microsoft.com/en-us/windows/win32/shell/context)
- [IContextMenu](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-icontextmenu)
- [How to Implement the IContextMenu Interface](https://learn.microsoft.com/en-us/windows/win32/shell/how-to-implement-the-icontextmenu-interface)
