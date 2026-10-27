//! Keyring Notes 앱 셸. 화면(web)과 로컬 볼트·동기화(packages/core)는 모두 TypeScript이고,
//! 여기서는 파일·폴더 선택·HTTP 플러그인과 데스크톱 업데이터, macOS 메뉴만 등록한다.
//! 권한 범위는 capabilities/default.json(모든 기기)·desktop.json(데스크톱만).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init());
    // persisted-scope 는 fs 플러그인 다음에 등록해야 한다.
    // 업데이터는 확인만 하고 설치는 화면에서 사람이 고른 뒤에 한다(web/src/update.tsx)
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    #[cfg(target_os = "macos")]
    let builder = macos_menu::install(builder);
    builder
        .run(tauri::generate_context!())
        .expect("Keyring Notes를 시작하지 못했습니다");
}

/// macOS 메뉴. Tauri 의 기본 메뉴(tauri::menu::Menu::default)와 같은 구성에서 둘만 바꾼다. 둘 다 저장 안 한 변경을 묻지 않고
/// 창을 닫던 길이다 — 창은 닫기 요청(CloseRequested)을 거쳐야 화면이 묻는다(web/src/closeWindow.ts).
/// - Close Window: 기본은 Cmd+W(performClose:)라, 웹뷰가 키를 흘려보낼 때(대화상자가 떠 있을 때) 「탭 닫기」 대신 창이 닫혔다.
///   화면의 「창 닫기」 명령과 같은 Cmd+Shift+W 로 바꾼다. 웹뷰가 그 키를 먼저 받아 처리하면 메뉴는 돌지 않는다.
/// - Quit: 기본은 terminate: 인데 tao 가 applicationShouldTerminate 를 두지 않아 창에 닫기 요청 없이 곧바로 끝났다.
///   창을 하나씩 닫기 요청하고(지금 창 먼저), 그 창이 사라지면 다음 창으로 간다. 어느 창이든 닫지 않기로 하면(화면이
///   close-cancelled 를 보낸다) 멈추고 남은 창은 그대로 둔다. 마지막 창이 사라지면 Tauri 가 앱을 끝낸다.
///   Dock 의 Quit·로그아웃은 여전히 terminate: 라 묻지 않는다(docs/ops/ux.md 6번 「남은 것」).
#[cfg(target_os = "macos")]
mod macos_menu {
    use std::sync::Mutex;
    use tauri::menu::{
        AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
        WINDOW_SUBMENU_ID,
    };
    use tauri::{AppHandle, Builder, Listener, Manager, Runtime, WindowEvent};

    const CLOSE_WINDOW: &str = "close-window";
    const QUIT: &str = "quit";

    /// 끝내기 중: 지금 닫기를 요청한 창과 그다음 차례인 창들
    #[derive(Default)]
    struct Quitting(Mutex<Option<(String, Vec<String>)>>);

    pub fn install<R: Runtime>(builder: Builder<R>) -> Builder<R> {
        builder
            .manage(Quitting::default())
            .menu(menu)
            .on_menu_event(|app, e| match e.id().as_ref() {
                CLOSE_WINDOW => {
                    if let Some(w) = focused(app) {
                        let _ = w.close();
                    }
                }
                QUIT => quit(app),
                _ => {}
            })
            .on_window_event(|w, e| {
                if let WindowEvent::Destroyed = e {
                    closed(w.app_handle(), w.label());
                }
            })
            .setup(|app| {
                let h = app.handle().clone();
                app.listen_any("close-cancelled", move |_| {
                    *h.state::<Quitting>().0.lock().unwrap() = None;
                });
                Ok(())
            })
    }

    fn focused<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::WebviewWindow<R>> {
        app.webview_windows()
            .into_values()
            .find(|w| w.is_focused().unwrap_or(false))
    }

    /// 지금 창부터, 나머지는 이름 순서로 하나씩 닫기를 요청한다
    fn quit<R: Runtime>(app: &AppHandle<R>) {
        let mut labels: Vec<String> = app.webview_windows().into_keys().collect();
        labels.sort();
        if let Some(f) = focused(app) {
            labels.retain(|l| l != f.label());
            labels.insert(0, f.label().to_string());
        }
        labels.reverse(); // 뒤에서 꺼낸다
        let first = labels.pop();
        if let Some(first) = first {
            *app.state::<Quitting>().0.lock().unwrap() = Some((first.clone(), labels));
            request_close(app, &first);
        }
    }

    fn request_close<R: Runtime>(app: &AppHandle<R>, label: &str) {
        match app.get_webview_window(label) {
            Some(w) => {
                let _ = w.close();
            }
            None => closed(app, label),
        }
    }

    /// 창이 사라졌다: 끝내기 중 지금 차례였으면 다음 창으로 간다(차례가 오기 전에 따로 닫힌 창은 순서에서 뺀다)
    fn closed<R: Runtime>(app: &AppHandle<R>, label: &str) {
        let next = {
            let state = app.state::<Quitting>();
            let mut q = state.0.lock().unwrap();
            let Some((current, rest)) = q.as_mut() else {
                return;
            };
            rest.retain(|l| l != label);
            if current != label {
                return;
            }
            match rest.pop() {
                Some(n) => {
                    *current = n.clone();
                    Some(n)
                }
                None => {
                    *q = None;
                    None
                }
            }
        };
        if let Some(n) = next {
            request_close(app, &n);
        }
    }

    fn menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
        let pkg = app.package_info();
        let config = app.config();
        let about = AboutMetadata {
            name: Some(pkg.name.clone()),
            version: Some(pkg.version.to_string()),
            copyright: config.bundle.copyright.clone(),
            authors: config.bundle.publisher.clone().map(|p| vec![p]),
            ..Default::default()
        };
        let close_window = MenuItem::with_id(
            app,
            CLOSE_WINDOW,
            "Close Window",
            true,
            Some("CmdOrCtrl+Shift+W"),
        )?;
        let quit = MenuItem::with_id(
            app,
            QUIT,
            format!("Quit {}", pkg.name),
            true,
            Some("CmdOrCtrl+Q"),
        )?;
        let window_menu = Submenu::with_id_and_items(
            app,
            WINDOW_SUBMENU_ID,
            "Window",
            true,
            &[
                &PredefinedMenuItem::minimize(app, None)?,
                &PredefinedMenuItem::maximize(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &close_window,
            ],
        )?;
        let help_menu = Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &[])?;
        Menu::with_items(
            app,
            &[
                &Submenu::with_items(
                    app,
                    pkg.name.clone(),
                    true,
                    &[
                        &PredefinedMenuItem::about(app, None, Some(about))?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::services(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::hide(app, None)?,
                        &PredefinedMenuItem::hide_others(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &quit,
                    ],
                )?,
                &Submenu::with_items(app, "File", true, &[&close_window])?,
                &Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(app, None)?,
                        &PredefinedMenuItem::redo(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::cut(app, None)?,
                        &PredefinedMenuItem::copy(app, None)?,
                        &PredefinedMenuItem::paste(app, None)?,
                        &PredefinedMenuItem::select_all(app, None)?,
                    ],
                )?,
                &Submenu::with_items(
                    app,
                    "View",
                    true,
                    &[&PredefinedMenuItem::fullscreen(app, None)?],
                )?,
                &window_menu,
                &help_menu,
            ],
        )
    }
}
