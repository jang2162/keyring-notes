//! Keyring Notes 앱 셸. 화면(web)과 로컬 볼트·동기화(packages/core)는 모두 TypeScript이고,
//! 여기서는 파일·폴더 선택·HTTP 플러그인과 데스크톱 업데이터만 등록한다.
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
    builder
        .run(tauri::generate_context!())
        .expect("Keyring Notes를 시작하지 못했습니다");
}
