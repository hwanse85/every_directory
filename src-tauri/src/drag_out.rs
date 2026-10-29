//! 선택한 파일을 운영체제 드래그로 넘겨 브라우저 업로드·탐색기·Finder 같은 다른 앱에 놓을 수 있게 한다.
//! 받는 앱은 복사로만 받는다. 앱 안의 탐색창 사이 끌기는 기존 앱 내부 끌기를 그대로 쓴다.
use std::path::PathBuf;

// 메인 스레드에서 운영체제 파일 드래그를 시작한다. Windows는 놓거나 취소할 때까지 기다린다.
pub fn start(window: &tauri::WebviewWindow, paths: Vec<PathBuf>) -> Result<(), String> {
    if paths.is_empty() {
        return Err("끌어 놓을 항목이 없습니다.".into());
    }
    #[cfg(windows)]
    let handle = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    #[cfg(target_os = "macos")]
    let handle = window.ns_window().map_err(|error| error.to_string())? as usize;
    #[cfg(any(windows, target_os = "macos"))]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                let _ = sender.send(begin(handle, &paths));
            })
            .map_err(|error| error.to_string())?;
        receiver
            .recv()
            .map_err(|_| "운영체제 드래그를 시작하지 못했습니다.".to_string())?
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (window, paths);
        Err("이 운영체제에서는 앱 밖으로 끌어 놓기를 지원하지 않습니다.".into())
    }
}

// 셸 데이터 개체로 Windows 드래그를 실행한다. 탐색기와 같은 파일 형식·끌기 이미지를 받는 앱에 제공한다.
#[cfg(windows)]
fn begin(hwnd: isize, paths: &[PathBuf]) -> Result<(), String> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::HWND,
            System::{
                Com::{IBindCtx, IDataObject},
                Ole::{IDropSource, OleInitialize, OleUninitialize, DROPEFFECT_COPY},
            },
            UI::{
                Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON},
                Shell::{
                    BHID_DataObject, Common::ITEMIDLIST, ILCreateFromPathW, ILFree,
                    IShellItemArray, SHCreateShellItemArrayFromIDLists, SHDoDragDrop,
                },
                WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON},
            },
        },
    };
    unsafe {
        // 단추를 이미 놓았으면 드래그를 시작하자마자 커서 아래에 놓이므로 시작하지 않는다.
        // 왼손잡이 설정(단추 바꿈)에서는 물리적 오른쪽 단추가 기본 단추다.
        let primary = if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON };
        if (GetAsyncKeyState(primary.0 as i32) as u16) & 0x8000 == 0 {
            return Ok(());
        }
        // 메인 스레드는 보통 이미 OLE가 초기화되어 있다. 성공한 호출만 짝을 맞춰 해제한다.
        let initialized = OleInitialize(None).is_ok();
        let mut items: Vec<*const ITEMIDLIST> = Vec::with_capacity(paths.len());
        let mut missing = None;
        for path in paths {
            let wide = crate::windows_file_ops::shell_path(path);
            let item = ILCreateFromPathW(PCWSTR(wide.as_ptr()));
            if item.is_null() {
                missing = Some(path);
                break;
            }
            items.push(item);
        }
        let result = match missing {
            Some(path) => Err(format!("{}을(를) 끌 수 없습니다.", path.display())),
            None => (|| -> windows::core::Result<()> {
                let array: IShellItemArray = SHCreateShellItemArrayFromIDLists(&items)?;
                let data: IDataObject = array.BindToHandler(None::<&IBindCtx>, &BHID_DataObject)?;
                // 기본 드롭 소스를 쓰면 끌기 이미지·Esc 취소·버튼을 놓을 때의 처리를 Windows가 맡는다.
                SHDoDragDrop(Some(HWND(hwnd as _)), &data, None::<&IDropSource>, DROPEFFECT_COPY)?;
                Ok(())
            })()
            .map_err(|error| format!("운영체제 드래그를 실행하지 못했습니다: {error}")),
        };
        for item in items {
            ILFree(Some(item));
        }
        if initialized {
            OleUninitialize();
        }
        result
    }
}

#[cfg(target_os = "macos")]
use mac::begin;

#[cfg(target_os = "macos")]
mod mac {
    use objc2::{
        define_class, msg_send,
        rc::Retained,
        runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject},
        AnyThread, MainThreadMarker, MainThreadOnly,
    };
    use objc2_app_kit::{
        NSApp, NSDragOperation, NSDraggingContext, NSDraggingItem, NSDraggingSession,
        NSDraggingSource, NSEvent, NSEventModifierFlags, NSEventType, NSWindow, NSWorkspace,
    };
    use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString, NSURL};
    use std::{cell::RefCell, path::PathBuf};

    define_class!(
        // 다른 앱에 놓을 때 복사만 허용하는 드래그 출처다.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "EveryDirectoryDragSource"]
        struct DragSource;

        unsafe impl NSObjectProtocol for DragSource {}

        unsafe impl NSDraggingSource for DragSource {
            #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
            fn operation_mask(
                &self,
                _session: &NSDraggingSession,
                _context: NSDraggingContext,
            ) -> NSDragOperation {
                NSDragOperation::Copy
            }
        }
    );

    impl DragSource {
        // 메인 스레드에서 드래그 출처 개체를 만든다.
        fn new(mtm: MainThreadMarker) -> Retained<Self> {
            unsafe { msg_send![Self::alloc(mtm), init] }
        }
    }

    thread_local! {
        // 드래그가 끝날 때까지 출처 개체를 살려 둔다. 다음 드래그에서 교체한다.
        static SOURCE: RefCell<Option<Retained<DragSource>>> = const { RefCell::new(None) };
    }

    // 파일 URL과 Finder 아이콘으로 드래그 세션을 시작한다. 세션은 AppKit이 이어서 처리한다.
    pub fn begin(window: usize, paths: &[PathBuf]) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("메인 스레드에서만 드래그를 시작할 수 있습니다.")?;
        // 단추를 이미 놓았으면 끝난 끌기이므로 시작하지 않는다.
        if NSEvent::pressedMouseButtons() & 1 == 0 {
            return Ok(());
        }
        let window = unsafe { &*(window as *const NSWindow) };
        let view = window.contentView().ok_or("창 화면을 찾을 수 없습니다.")?;
        let point = window.mouseLocationOutsideOfEventStream();
        let names: Vec<Retained<NSString>> = paths
            .iter()
            .map(|path| NSString::from_str(&path.to_string_lossy()))
            .collect();
        let workspace = NSWorkspace::sharedWorkspace();
        let icon = if names.len() == 1 {
            workspace.iconForFile(&names[0])
        } else {
            workspace
                .iconForFiles(&NSArray::from_retained_slice(&names))
                .unwrap_or_else(|| workspace.iconForFile(&names[0]))
        };
        let size = NSSize::new(64.0, 64.0);
        icon.setSize(size);
        let local = view.convertPoint_fromView(point, None);
        let frame = NSRect::new(NSPoint::new(local.x - 32.0, local.y - 32.0), size);
        let contents: &AnyObject = &icon;
        let items: Vec<Retained<NSDraggingItem>> = names
            .iter()
            .map(|name| {
                let url = NSURL::fileURLWithPath(name);
                let item = NSDraggingItem::initWithPasteboardWriter(
                    NSDraggingItem::alloc(),
                    ProtocolObject::from_ref(&*url),
                );
                unsafe { item.setDraggingFrame_contents(frame, Some(contents)) };
                item
            })
            .collect();
        let timestamp = NSApp(mtm).currentEvent().map_or(0.0, |event| event.timestamp());
        let event = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
            NSEventType::LeftMouseDragged,
            point,
            NSEventModifierFlags::empty(),
            timestamp,
            window.windowNumber(),
            None,
            0,
            1,
            1.0,
        )
        .ok_or("드래그 이벤트를 만들 수 없습니다.")?;
        let source = DragSource::new(mtm);
        view.beginDraggingSessionWithItems_event_source(
            &NSArray::from_retained_slice(&items),
            &event,
            ProtocolObject::from_ref(&*source),
        );
        SOURCE.with(|cell| cell.replace(Some(source)));
        Ok(())
    }
}
