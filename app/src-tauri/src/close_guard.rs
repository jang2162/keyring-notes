//! 창 닫기 지킴(데스크톱). 저장 안 한 변경이 있는 창은 어느 길로 닫든(닫기 단추·Alt+F4·「창 닫기」·Quit·업데이트 뒤 다시 시작)
//! 먼저 묻는다(web/src/closeWindow.ts).
//!
//! 닫을지 말지는 여기서 정한다. 화면은 저장 안 한 변경이 생기고 없어질 때 「지킴」을 켜고 끈다(set_close_guard).
//! 지킴이 꺼진 창은 그대로 닫힌다. 켜진 창은 닫기를 막고 화면에 물음을 요청한다(close-ask).
//! Tauri 의 JS 닫기 리스너(onCloseRequested)에 맡기지 않는 까닭: 리스너가 하나라도 있으면 Tauri 가 닫기를 막는데, 그 리스너는
//! 페이지가 다시 로드돼도 남는다. 그래서 새로고침으로 처리기가 사라진 창은 닫히지도, Quit 이 끝나지도 않았다.
//! 지킴은 새 페이지가 로드되기 시작하면(on_page_load) 끈다.
//!
//! 화면이 ANSWER_TIMEOUT 안에 물음 요청을 받았다고 답하지 않으면(웹뷰가 멈췄거나 죽었다) OS 대화상자로 직접 묻는다.
//! 묻지 않고 버리지도 않고, 답할 수 없는 창 때문에 앱이 영영 안 꺼지지도 않게 하는 갈림길이다(docs/ops/ux.md 6번).
//!
//! 여러 창을 차례로 닫는 순서(Sequence)는 macOS 메뉴의 Quit 과 업데이트 뒤 다시 시작이 쓴다: 지금 창 먼저, 나머지는 이름 순서.
//! 어느 창이든 닫지 않기로 하면 멈추고 남은 창은 그대로 둔다.
//!
//! 메뉴의 Quit 은 새 버전이 있으면 차례에 앞서 업데이트를 묻는다(UpdateQuit). 새 버전은 화면만 알므로 실행 때 확인한 창이 알려 둔다.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Builder, Emitter, EventTarget, Manager, WebviewWindow, WindowEvent, Wry};

/// 화면이 물음 요청을 받았다고 답하기를 기다리는 시간. 넘으면 응답하지 않는 창으로 보고 OS 대화상자로 묻는다
const ANSWER_TIMEOUT: Duration = Duration::from_secs(3);

/// 응답하지 않는 창에서 띄울 OS 대화상자의 글. 화면이 지킴을 켤 때 그때 언어로 넘긴다
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Fallback {
    pub message: String,
    pub discard: String,
    pub cancel: String,
}

impl Default for Fallback {
    fn default() -> Self {
        Fallback {
            message: "This window isn't responding and has unsaved changes. Close it anyway? The unsaved changes will be lost.".into(),
            discard: "Close without saving".into(),
            cancel: "Cancel".into(),
        }
    }
}

/// OS 대화상자의 단추. 첫 단추가 기본(macOS 의 Return, Windows 의 Enter)이므로 「취소」를 먼저 둔다 — Return 한 번에 초안을 버리지 않게
pub fn fallback_buttons(text: &Fallback) -> rfd::MessageButtons {
    rfd::MessageButtons::OkCancelCustom(text.cancel.clone(), text.discard.clone())
}

/// OS 대화상자에서 「저장하지 않고 닫기」 단추를 눌렀는가. 그 단추일 때만 버린다 — 「취소」와 단추가 아닌 끝(Escape·대화상자 닫기)은
/// 모두 취소다. 두 글이 같으면 어느 단추인지 가를 수 없으니 취소로 본다
pub fn chose_discard(text: &Fallback, result: &rfd::MessageDialogResult) -> bool {
    text.discard != text.cancel && *result == rfd::MessageDialogResult::Custom(text.discard.clone())
}

/// 창 하나의 지킴 상태
#[derive(Default)]
struct Win {
    /// 저장 안 한 변경이 있다(켜져 있으면 닫기를 막고 묻는다). 켤 때 받은 대화상자 글
    guard: Option<Fallback>,
    /// 지킴을 마지막으로 바꾼 페이지(문서)의 번호. 새 페이지가 로드되기 시작하면 비우고 gone 에 넣는다
    page: Option<u64>,
    /// 이 창에서 사라진 페이지들. 페이지가 바뀐 뒤 늦게 닿은 그 페이지의 요청을 버린다
    gone: Vec<u64>,
    /// 지킴을 마지막으로 바꾼 요청의 번호(페이지 안에서 센다). 늦게 도착한 옛 요청은 버린다
    seq: u64,
    /// 물음 요청을 보내고 화면의 답을 기다리는 중(요청 번호)
    probe: Option<u64>,
    /// 화면이 묻고 있다
    web: bool,
    /// OS 대화상자로 묻고 있다
    native: bool,
}

/// 닫기 요청을 어떻게 할지
#[derive(Debug, PartialEq)]
pub enum OnClose {
    /// 막지 않는다(그대로 닫힌다)
    Close,
    /// 막기만 한다(이미 묻고 있다)
    Block,
    /// 막고 화면에 이 번호로 물음을 요청한다
    Ask(u64),
}

/// 창마다의 지킴. Tauri 와 떨어진 순수 상태라 단위 시험을 붙인다
#[derive(Default)]
pub struct Guards {
    wins: HashMap<String, Win>,
    next: u64,
}

impl Guards {
    /// 화면이 지킴을 켜거나(Some) 끈다(None). page 는 요청한 페이지(문서)의 번호(화면이 문서를 만든 시각에서 얻는다), seq 는 그 페이지 안의 번호다.
    /// 늦게 닿은 옛 요청은 버린다: 같은 페이지의 지난 번호 이하, 사라진 페이지의 요청, 그리고 두 페이지가 겹치면 먼저 만든 페이지의 요청
    pub fn set(&mut self, label: &str, page: u64, seq: u64, guard: Option<Fallback>) {
        let w = self.wins.entry(label.into()).or_default();
        if w.gone.contains(&page) {
            return;
        }
        match w.page {
            Some(p) if p == page && seq <= w.seq => return,
            Some(p) if p == page => {}
            // 페이지가 바뀐 뒤 아직 지킴을 바꾸지 않은 옛 페이지의 첫 요청과 새 페이지의 요청이 겹쳤다: 나중에 만든 페이지를 따른다
            Some(p) if p > page => {
                w.gone.push(page);
                return;
            }
            Some(p) => w.gone.push(p),
            None => {}
        }
        w.page = Some(page);
        w.seq = seq;
        w.guard = guard;
    }

    pub fn close_requested(&mut self, label: &str) -> OnClose {
        let w = self.wins.entry(label.into()).or_default();
        if w.native || w.probe.is_some() {
            return OnClose::Block;
        }
        // 화면이 묻는 중이면 지킴과 상관없이 다시 요청한다 — 묻다가 멈춘 창이면 답이 없어 OS 대화상자로 넘어간다
        if w.guard.is_none() && !w.web {
            return OnClose::Close;
        }
        self.next += 1;
        w.probe = Some(self.next);
        OnClose::Ask(self.next)
    }

    /// 화면이 물음 요청을 받았다. 새로 물어야 하면 true(이미 묻고 있거나, 늦어서 OS 대화상자로 넘어갔으면 false)
    pub fn ack(&mut self, label: &str, id: u64) -> bool {
        let Some(w) = self.wins.get_mut(label) else {
            return false;
        };
        if w.probe != Some(id) {
            return false;
        }
        w.probe = None;
        if w.web {
            return false;
        }
        w.web = true;
        true
    }

    /// 기다리던 답이 오지 않았다. OS 대화상자로 물어야 하면 그 글
    pub fn timed_out(&mut self, label: &str, id: u64) -> Option<Fallback> {
        let w = self.wins.get_mut(label)?;
        if w.probe != Some(id) {
            return None;
        }
        w.probe = None;
        w.web = false;
        w.native = true;
        Some(w.guard.clone().unwrap_or_default())
    }

    /// 화면이 묻고 나서 닫지 않기로 했다(취소·저장 실패)
    pub fn web_done(&mut self, label: &str) {
        if let Some(w) = self.wins.get_mut(label) {
            w.web = false;
        }
    }

    /// OS 대화상자가 끝났다
    pub fn native_done(&mut self, label: &str) {
        if let Some(w) = self.wins.get_mut(label) {
            w.native = false;
        }
    }

    /// 새 페이지가 로드되기 시작했다: 지킴을 끈다(새 페이지가 다시 켠다). 옛 페이지는 사라진 것으로 적어 늦게 닿은 요청을 버린다.
    /// 묻던 중이었으면 true(그 물음은 사라졌다)
    pub fn page_loaded(&mut self, label: &str) -> bool {
        let Some(w) = self.wins.get_mut(label) else {
            return false;
        };
        let asking = w.web || w.probe.is_some();
        if let Some(p) = w.page.take() {
            w.gone.push(p);
        }
        w.guard = None;
        w.seq = 0;
        w.probe = None;
        w.web = false;
        asking
    }

    pub fn destroyed(&mut self, label: &str) {
        self.wins.remove(label);
    }
}

/// 차례로 다 닫은 뒤 할 일
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum After {
    /// 끝낸다(마지막 창이 사라지면 Tauri 가 끝낸다)
    Exit,
    /// 다시 시작한다(업데이트 설치 뒤)
    Restart,
}

/// 여러 창을 하나씩 닫는 순서: 지금 닫기를 요청한 창과 그다음 차례인 창들
#[derive(Debug, PartialEq)]
pub struct Sequence {
    current: String,
    /// 뒤에서 꺼낸다
    rest: Vec<String>,
    pub after: After,
}

/// 순서의 다음 걸음
#[derive(Debug, PartialEq)]
pub enum Step {
    /// 이 창에 닫기를 요청한다
    Close(String),
    /// 다 닫았다
    Done(After),
    /// 지금 차례가 아닌 창이 따로 닫혔다
    Wait,
}

impl Sequence {
    /// 지금 창부터, 나머지는 이름 순서로. 창이 없으면 None
    pub fn start(
        mut labels: Vec<String>,
        focused: Option<&str>,
        after: After,
    ) -> Option<(Sequence, String)> {
        labels.sort();
        if let Some(f) = focused.filter(|f| labels.iter().any(|l| l == f)) {
            labels.retain(|l| l != f);
            labels.insert(0, f.to_string());
        }
        labels.reverse();
        let current = labels.pop()?;
        Some((
            Sequence {
                current: current.clone(),
                rest: labels,
                after,
            },
            current,
        ))
    }

    /// 창이 사라졌다: 지금 차례였으면 다음 창으로 간다(차례가 오기 전에 따로 닫힌 창은 순서에서 뺀다)
    pub fn destroyed(&mut self, label: &str) -> Step {
        self.rest.retain(|l| l != label);
        if self.current != label {
            return Step::Wait;
        }
        match self.rest.pop() {
            Some(n) => {
                self.current = n.clone();
                Step::Close(n)
            }
            None => Step::Done(self.after),
        }
    }

    /// 이 창의 물음이 사라졌을 때 순서를 멈춰야 하는가(지금 차례인 창일 때만)
    pub fn waits_on(&self, label: &str) -> bool {
        self.current == label
    }
}

/// 이 창이 닫지 않기로 했다: 순서가 이 창을 기다리던 중이면 멈추고 그 뒤 할 일을 돌려준다.
/// 차례와 상관없는 창(사람이 따로 닫으려다 취소한 창)이면 순서를 그대로 둔다
pub fn stop_for(seq: &mut Option<Sequence>, label: &str) -> Option<After> {
    if seq.as_ref().is_some_and(|s| s.waits_on(label)) {
        seq.take().map(|s| s.after)
    } else {
        None
    }
}

/// Quit 앞의 업데이트 물음. 새 버전을 찾은 창이 알려 두면(set_update_pending) Quit 이 그 창에 물음을 요청한다(quit-ask).
/// 화면이 ANSWER_TIMEOUT 안에 받았다고 답하지 않으면 묻지 않고 Quit 차례로 간다 — 응답하지 않는 창 때문에 Quit 이 막히지 않게
#[derive(Default)]
pub struct UpdateQuit {
    /// 새 버전이 있다고 알린 창
    pending: Option<String>,
    /// 물음 요청을 보내고 화면의 답을 기다리는 중(요청 번호)
    probe: Option<u64>,
    /// 화면이 묻고 있다(받고 설치하는 동안도)
    asking: bool,
    next: u64,
}

/// Quit 을 어떻게 할지
#[derive(Debug, PartialEq)]
pub enum OnQuit {
    /// 새 버전이 없다: 바로 Quit 차례로
    CloseAll,
    /// 앞서 보낸 물음 요청의 답을 기다리는 중
    Wait,
    /// 이 창에 이 번호로 물음을 요청한다
    Ask(String, u64),
}

impl UpdateQuit {
    pub fn set_pending(&mut self, label: &str, pending: bool) {
        if pending {
            self.pending = Some(label.into());
        } else if self.pending.as_deref() == Some(label) {
            self.pending = None;
        }
    }

    pub fn quit(&mut self) -> OnQuit {
        let Some(label) = self.pending.clone() else {
            return OnQuit::CloseAll;
        };
        if self.probe.is_some() {
            return OnQuit::Wait;
        }
        // 화면이 묻는 중이어도 다시 요청한다 — 묻다가 멈춘 창이면 답이 없어 Quit 차례로 넘어간다
        self.next += 1;
        self.probe = Some(self.next);
        OnQuit::Ask(label, self.next)
    }

    /// 화면이 물음 요청을 받았다. 새로 물어야 하면 true(이미 묻고 있거나, 늦어서 Quit 차례로 넘어갔으면 false)
    pub fn ack(&mut self, id: u64) -> bool {
        if self.probe != Some(id) {
            return false;
        }
        self.probe = None;
        if self.asking {
            return false;
        }
        self.asking = true;
        true
    }

    /// 기다리던 답이 오지 않았다. 묻지 않고 Quit 차례로 가야 하면 true
    pub fn timed_out(&mut self, id: u64) -> bool {
        if self.probe != Some(id) {
            return false;
        }
        self.probe = None;
        self.asking = false;
        true
    }

    /// 화면이 묻기를 끝냈다(고른 것과 상관없이)
    pub fn done(&mut self) {
        self.asking = false;
    }

    /// 창이 다시 로드되기 시작했거나 사라졌다: 그 창이 알린 새 버전은 잊는다(새 페이지가 다시 확인해 알린다).
    /// 기다리던 요청은 그대로 두어 시간이 지나면 Quit 차례로 간다
    pub fn gone(&mut self, label: &str) {
        if self.pending.as_deref() == Some(label) {
            self.pending = None;
            self.asking = false;
        }
    }
}

#[derive(Default)]
struct State {
    guards: Mutex<Guards>,
    sequence: Mutex<Option<Sequence>>,
    update_quit: Mutex<UpdateQuit>,
}

pub fn install(builder: Builder<Wry>) -> Builder<Wry> {
    builder
        .manage(State::default())
        .invoke_handler(tauri::generate_handler![
            set_close_guard,
            close_ask_ack,
            close_ask_done,
            restart_after_closing,
            set_update_pending,
            quit_ask_ack,
            quit_ask_done
        ])
        .on_window_event(|w, e| match e {
            WindowEvent::CloseRequested { api, .. } => {
                let app = w.app_handle();
                let label = w.label().to_string();
                let on = app
                    .state::<State>()
                    .guards
                    .lock()
                    .unwrap()
                    .close_requested(&label);
                match on {
                    OnClose::Close => {}
                    OnClose::Block => api.prevent_close(),
                    OnClose::Ask(id) => {
                        api.prevent_close();
                        ask(app, label, id);
                    }
                }
            }
            WindowEvent::Destroyed => destroyed(w.app_handle(), w.label()),
            _ => {}
        })
        .on_page_load(|wv, p| {
            if p.event() != PageLoadEvent::Started {
                return;
            }
            let app = wv.app_handle();
            app.state::<State>()
                .update_quit
                .lock()
                .unwrap()
                .gone(wv.label());
            let cut = app
                .state::<State>()
                .guards
                .lock()
                .unwrap()
                .page_loaded(wv.label());
            if cut {
                cancel(app, wv.label());
            }
        })
}

/// 화면에 물음을 요청하고, 답이 없으면 OS 대화상자로 묻는다
fn ask(app: &AppHandle, label: String, id: u64) {
    let _ = app.emit_to(EventTarget::webview_window(&label), "close-ask", id);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(ANSWER_TIMEOUT);
        let text = app
            .state::<State>()
            .guards
            .lock()
            .unwrap()
            .timed_out(&label, id);
        if let Some(text) = text {
            ask_natively(&app, label, text);
        }
    });
}

/// dialog 플러그인을 거치지 않고 rfd 를 바로 부른다: 플러그인은 단추가 아닌 끝(Escape·대화상자 닫기)을 두 번째 단추를 누른 것으로
/// 바꿔 돌려주므로, 「취소」를 첫 단추(기본)에 두면 Escape 가 「저장하지 않고 닫기」가 된다
fn ask_natively(app: &AppHandle, label: String, text: Fallback) {
    let Some(w) = app.get_webview_window(&label) else {
        return;
    };
    let _ = w.unminimize();
    let _ = w.set_focus();
    let title = app.package_info().name.clone();
    let handle = app.clone();
    // 대화상자는 메인 스레드에서 만들고, 답은 다른 스레드에서 기다린다(dialog 플러그인과 같은 방식)
    let _ = app.run_on_main_thread(move || {
        let dialog = rfd::AsyncMessageDialog::new()
            .set_title(&title)
            .set_description(&text.message)
            .set_level(rfd::MessageLevel::Warning)
            .set_buttons(fallback_buttons(&text))
            .set_parent(&w)
            .show();
        std::thread::spawn(move || {
            let result = tauri::async_runtime::block_on(dialog);
            handle
                .state::<State>()
                .guards
                .lock()
                .unwrap()
                .native_done(&label);
            match handle.get_webview_window(&label) {
                Some(w) if chose_discard(&text, &result) => {
                    let _ = w.destroy();
                }
                _ => cancel(&handle, &label),
            }
        });
    });
}

/// 메뉴의 Quit: 새 버전이 있으면 그 창에 먼저 묻고(quit-ask), 없으면 차례로 닫는다
pub fn quit(app: &AppHandle) {
    let on = app.state::<State>().update_quit.lock().unwrap().quit();
    match on {
        OnQuit::CloseAll => close_all(app, After::Exit),
        OnQuit::Wait => {}
        OnQuit::Ask(label, id) => ask_quit(app, label, id),
    }
}

/// 새 버전을 알린 창에 Quit 물음을 요청하고, 답이 없으면 묻지 않고 차례로 닫는다
fn ask_quit(app: &AppHandle, label: String, id: u64) {
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        let _ = w.set_focus();
        let _ = app.emit_to(EventTarget::webview_window(&label), "quit-ask", id);
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(ANSWER_TIMEOUT);
        let late = app
            .state::<State>()
            .update_quit
            .lock()
            .unwrap()
            .timed_out(id);
        if late {
            close_all(&app, After::Exit);
        }
    });
}

/// 차례로 닫기를 시작한다(지금 창 먼저)
pub fn close_all(app: &AppHandle, after: After) {
    let labels: Vec<String> = app.webview_windows().into_keys().collect();
    let focused = app
        .webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
        .map(|w| w.label().to_string());
    match Sequence::start(labels, focused.as_deref(), after) {
        Some((seq, first)) => {
            *app.state::<State>().sequence.lock().unwrap() = Some(seq);
            request_close(app, &first);
        }
        None => finish(app, after),
    }
}

/// 차례가 된 창에 닫기를 요청한다. 물음이 보이도록 앞으로 가져온다(최소화돼 있거나 뒤에 있을 수 있다)
fn request_close(app: &AppHandle, label: &str) {
    match app.get_webview_window(label) {
        Some(w) => {
            let _ = w.unminimize();
            let _ = w.set_focus();
            let _ = w.close();
        }
        None => destroyed(app, label),
    }
}

fn destroyed(app: &AppHandle, label: &str) {
    app.state::<State>().guards.lock().unwrap().destroyed(label);
    app.state::<State>().update_quit.lock().unwrap().gone(label);
    let step = match app.state::<State>().sequence.lock().unwrap().as_mut() {
        Some(seq) => seq.destroyed(label),
        None => return,
    };
    match step {
        Step::Close(next) => request_close(app, &next),
        Step::Done(after) => {
            *app.state::<State>().sequence.lock().unwrap() = None;
            // 차례를 도는 사이 새로 열린 창이 있으면 그 창들도 묻는다
            let left: Vec<String> = app
                .webview_windows()
                .into_keys()
                .filter(|l| l != label)
                .collect();
            if left.is_empty() {
                finish(app, after);
            } else {
                close_all(app, after);
            }
        }
        Step::Wait => {}
    }
}

fn finish(app: &AppHandle, after: After) {
    match after {
        // 마지막 창이 사라지면 Tauri 가 끝낸다
        After::Exit => {}
        After::Restart => app.request_restart(),
    }
}

/// 이 창이 닫지 않기로 했다: 차례 닫기가 이 창을 기다리던 중이면 멈춘다(stop_for). 다시 시작하던 중이었으면 화면에 알린다
fn cancel(app: &AppHandle, label: &str) {
    let stopped = stop_for(&mut app.state::<State>().sequence.lock().unwrap(), label);
    if stopped == Some(After::Restart) {
        let _ = app.emit("restart-cancelled", ());
    }
}

/// 저장 안 한 변경이 생기면 켜고(text: 응답하지 않을 때 띄울 OS 대화상자 글), 없어지면 끈다(null). page·seq 는 Guards::set
#[tauri::command]
fn set_close_guard(
    window: WebviewWindow,
    state: tauri::State<'_, State>,
    page: u64,
    seq: u64,
    text: Option<Fallback>,
) {
    state
        .guards
        .lock()
        .unwrap()
        .set(window.label(), page, seq, text);
}

/// 물음 요청(close-ask)을 받았다. 새로 물어야 하면 true
#[tauri::command]
fn close_ask_ack(window: WebviewWindow, state: tauri::State<'_, State>, id: u64) -> bool {
    state.guards.lock().unwrap().ack(window.label(), id)
}

/// 물은 뒤 닫지 않기로 했다(취소·저장 실패): 차례 닫기가 이 창을 기다리던 중이면 멈춘다
#[tauri::command]
fn close_ask_done(app: AppHandle, window: WebviewWindow, state: tauri::State<'_, State>) {
    state.guards.lock().unwrap().web_done(window.label());
    cancel(&app, window.label());
}

/// 업데이트를 설치한 뒤: 창마다 Quit 과 같은 순서로 물은 뒤 다시 시작한다. 누가 취소하면 restart-cancelled 를 보낸다
#[tauri::command]
fn restart_after_closing(app: AppHandle) {
    close_all(&app, After::Restart);
}

/// 이 창이 새 버전을 찾았다(true), 설치했거나 다음 확인에서 없었다(false). 메뉴의 Quit 이 이 창에 먼저 묻는다
#[tauri::command]
fn set_update_pending(window: WebviewWindow, state: tauri::State<'_, State>, pending: bool) {
    state
        .update_quit
        .lock()
        .unwrap()
        .set_pending(window.label(), pending);
}

/// Quit 물음 요청(quit-ask)을 받았다. 새로 물어야 하면 true
#[tauri::command]
fn quit_ask_ack(state: tauri::State<'_, State>, id: u64) -> bool {
    state.update_quit.lock().unwrap().ack(id)
}

/// Quit 물음을 끝냈다. quit 이면(설치하고 종료·그냥 종료) 차례로 닫는다 — 창마다 저장 안 한 변경을 묻는다
#[tauri::command]
fn quit_ask_done(app: AppHandle, state: tauri::State<'_, State>, quit: bool) {
    state.update_quit.lock().unwrap().done();
    if quit {
        close_all(&app, After::Exit);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 테스트 페이지 번호(화면은 문서를 만든 시각에서 얻는다 — 나중 페이지가 크다)
    const OLD: u64 = 100;
    const NEW: u64 = 200;

    fn on(g: &mut Guards, label: &str, seq: u64) {
        g.set(label, OLD, seq, Some(Fallback::default()));
    }

    fn asks(g: &mut Guards) -> bool {
        matches!(g.close_requested("main"), OnClose::Ask(_))
    }

    #[test]
    fn 지킴이_꺼진_창은_그대로_닫힌다() {
        let mut g = Guards::default();
        assert_eq!(g.close_requested("main"), OnClose::Close);
        on(&mut g, "main", 1);
        g.set("main", OLD, 2, None);
        assert_eq!(g.close_requested("main"), OnClose::Close);
    }

    #[test]
    fn 지킴이_켜진_창은_막고_묻는다() {
        let mut g = Guards::default();
        on(&mut g, "main", 1);
        let OnClose::Ask(id) = g.close_requested("main") else {
            panic!()
        };
        assert!(g.ack("main", id));
    }

    #[test]
    fn 새_페이지가_로드되면_지킴이_꺼져_닫힌다() {
        // 새로고침으로 처리기가 사라진 창(리뷰 지적 1): 막히기만 하고 아무도 닫지 않던 길
        let mut g = Guards::default();
        on(&mut g, "main", 5);
        assert!(!g.page_loaded("main"));
        assert_eq!(g.close_requested("main"), OnClose::Close);
        // 새 페이지는 페이지 번호가 다르고 요청 번호를 처음부터 센다
        g.set("main", NEW, 1, Some(Fallback::default()));
        assert!(asks(&mut g));
    }

    #[test]
    fn 페이지가_바뀐_뒤_늦게_닿은_옛_페이지의_요청은_버린다() {
        // 재리뷰 지적 2: 옛 페이지의 seq=7, None 이 새 페이지의 지킴 켜기(1~)를 가리던 길
        let mut g = Guards::default();
        on(&mut g, "main", 5);
        g.page_loaded("main");
        g.set("main", NEW, 1, Some(Fallback::default()));
        g.set("main", OLD, 7, None);
        assert!(asks(&mut g));
        // 반대로 옛 페이지의 지킴 켜기가 늦게 닿아도 새 페이지의 끔을 가리지 않는다
        let mut g = Guards::default();
        on(&mut g, "main", 5);
        g.page_loaded("main");
        g.set("main", NEW, 1, None);
        on(&mut g, "main", 6);
        assert_eq!(g.close_requested("main"), OnClose::Close);
        // 새 페이지의 요청이 닿기 전이어도 옛 페이지의 요청은 버린다
        let mut g = Guards::default();
        on(&mut g, "main", 5);
        g.page_loaded("main");
        on(&mut g, "main", 6);
        assert_eq!(g.close_requested("main"), OnClose::Close);
    }

    #[test]
    fn 지킴을_바꾼_적_없는_옛_페이지의_요청과_새_페이지가_겹치면_나중_페이지를_따른다() {
        // 새 페이지가 먼저 닿고 옛 페이지의 첫 요청이 늦게 닿았다
        let mut g = Guards::default();
        g.page_loaded("main");
        g.set("main", NEW, 1, Some(Fallback::default()));
        g.set("main", OLD, 1, None);
        assert!(asks(&mut g));
        // 옛 페이지의 첫 요청이 먼저 닿았다: 새 페이지가 오면 그쪽을 따르고, 그 뒤 옛 페이지의 요청은 버린다
        let mut g = Guards::default();
        g.set("main", OLD, 1, Some(Fallback::default()));
        g.set("main", NEW, 1, None);
        assert_eq!(g.close_requested("main"), OnClose::Close);
        g.set("main", OLD, 2, Some(Fallback::default()));
        assert_eq!(g.close_requested("main"), OnClose::Close);
    }

    #[test]
    fn 묻던_중에_새_페이지가_로드되면_알린다() {
        let mut g = Guards::default();
        on(&mut g, "main", 1);
        let OnClose::Ask(id) = g.close_requested("main") else {
            panic!()
        };
        assert!(g.ack("main", id));
        assert!(g.page_loaded("main"));
    }

    #[test]
    fn 늦게_온_옛_지킴_요청은_버린다() {
        let mut g = Guards::default();
        on(&mut g, "main", 2);
        g.set("main", OLD, 1, None);
        assert!(asks(&mut g));
    }

    #[test]
    fn 답을_기다리거나_os_대화상자가_떠_있으면_막기만_한다() {
        let mut g = Guards::default();
        on(&mut g, "main", 1);
        let OnClose::Ask(id) = g.close_requested("main") else {
            panic!()
        };
        assert_eq!(g.close_requested("main"), OnClose::Block);
        assert!(g.timed_out("main", id).is_some());
        assert_eq!(g.close_requested("main"), OnClose::Block);
        g.native_done("main");
        assert!(matches!(g.close_requested("main"), OnClose::Ask(_)));
    }

    #[test]
    fn 답하지_않으면_os_대화상자로_넘어가고_늦은_답은_묻지_않게_한다() {
        let mut g = Guards::default();
        g.set(
            "main",
            OLD,
            1,
            Some(Fallback {
                message: "m".into(),
                discard: "d".into(),
                cancel: "c".into(),
            }),
        );
        let OnClose::Ask(id) = g.close_requested("main") else {
            panic!()
        };
        assert_eq!(g.timed_out("main", id).map(|f| f.message), Some("m".into()));
        assert!(!g.ack("main", id));
    }

    #[test]
    fn 답한_요청은_시간이_지나도_os_대화상자를_띄우지_않는다() {
        let mut g = Guards::default();
        on(&mut g, "main", 1);
        let OnClose::Ask(id) = g.close_requested("main") else {
            panic!()
        };
        assert!(g.ack("main", id));
        assert_eq!(g.timed_out("main", id), None);
    }

    #[test]
    fn 화면이_묻는_중_또_온_요청은_다시_답을_확인하되_물음을_겹치지_않는다() {
        let mut g = Guards::default();
        on(&mut g, "main", 1);
        let OnClose::Ask(a) = g.close_requested("main") else {
            panic!()
        };
        assert!(g.ack("main", a));
        // 묻다가 멈춘 창인지 확인하려고 다시 요청한다. 살아 있으면 답하지만 새로 묻지는 않는다
        let OnClose::Ask(b) = g.close_requested("main") else {
            panic!()
        };
        assert!(!g.ack("main", b));
        // 묻는 중 지킴이 꺼졌어도(그사이 저장됨) 묻기가 끝나기 전에는 확인을 거친다
        g.set("main", OLD, 2, None);
        let OnClose::Ask(c) = g.close_requested("main") else {
            panic!()
        };
        assert!(g.timed_out("main", c).is_some());
    }

    #[test]
    fn 화면이_닫지_않기로_하면_다음_요청에_다시_묻는다() {
        let mut g = Guards::default();
        on(&mut g, "main", 1);
        let OnClose::Ask(id) = g.close_requested("main") else {
            panic!()
        };
        assert!(g.ack("main", id));
        g.web_done("main");
        let OnClose::Ask(id) = g.close_requested("main") else {
            panic!()
        };
        assert!(g.ack("main", id));
    }

    fn labels(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn 순서는_지금_창_먼저_나머지는_이름_순() {
        let (mut s, first) = Sequence::start(
            labels(&["solo-b", "main", "solo-a"]),
            Some("solo-b"),
            After::Exit,
        )
        .unwrap();
        assert_eq!(first, "solo-b");
        assert_eq!(s.destroyed("solo-b"), Step::Close("main".into()));
        assert_eq!(s.destroyed("main"), Step::Close("solo-a".into()));
        assert_eq!(s.destroyed("solo-a"), Step::Done(After::Exit));
    }

    #[test]
    fn 차례_전에_따로_닫힌_창은_건너뛴다() {
        let (mut s, _) =
            Sequence::start(labels(&["main", "solo-a", "solo-b"]), None, After::Restart).unwrap();
        assert_eq!(s.destroyed("solo-a"), Step::Wait);
        assert_eq!(s.destroyed("main"), Step::Close("solo-b".into()));
        assert_eq!(s.destroyed("solo-b"), Step::Done(After::Restart));
    }

    #[test]
    fn 지금_차례인_창만_순서를_붙잡는다() {
        let (s, _) =
            Sequence::start(labels(&["main", "solo-a"]), Some("main"), After::Exit).unwrap();
        assert!(s.waits_on("main"));
        assert!(!s.waits_on("solo-a"));
        assert_eq!(Sequence::start(vec![], None, After::Exit), None);
    }

    #[test]
    fn 차례가_기다리는_창이_취소할_때만_순서를_멈춘다() {
        // 재리뷰 지적 4: Quit 차례가 main 에 있을 때 사람이 solo-a 를 따로 닫으려다 취소했다
        let mut seq = Sequence::start(labels(&["main", "solo-a"]), Some("main"), After::Restart)
            .map(|(s, _)| s);
        assert_eq!(stop_for(&mut seq, "solo-a"), None);
        assert!(seq.is_some());
        assert_eq!(stop_for(&mut seq, "main"), Some(After::Restart));
        assert!(seq.is_none());
        assert_eq!(stop_for(&mut seq, "main"), None);
    }

    fn text() -> Fallback {
        Fallback {
            message: "m".into(),
            discard: "저장하지 않고 닫기".into(),
            cancel: "취소".into(),
        }
    }

    #[test]
    fn os_대화상자의_첫_단추_곧_기본_단추는_취소다() {
        // 재리뷰 지적 1: 첫 단추가 「저장하지 않고 닫기」라 Return 한 번에 초안을 버렸다
        let rfd::MessageButtons::OkCancelCustom(first, second) = fallback_buttons(&text()) else {
            panic!()
        };
        assert_eq!(first, "취소");
        assert_eq!(second, "저장하지 않고 닫기");
    }

    #[test]
    fn os_대화상자는_저장하지_않고_닫기_단추를_눌렀을_때만_버린다() {
        use rfd::MessageDialogResult as R;
        let t = text();
        assert!(chose_discard(&t, &R::Custom("저장하지 않고 닫기".into())));
        assert!(!chose_discard(&t, &R::Custom("취소".into())));
        // 단추가 아닌 끝(Escape·대화상자 닫기)
        assert!(!chose_discard(&t, &R::Cancel));
        assert!(!chose_discard(&t, &R::Ok));
        let same = Fallback {
            cancel: "x".into(),
            discard: "x".into(),
            ..t
        };
        assert!(!chose_discard(&same, &R::Custom("x".into())));
    }
    #[test]
    fn 새_버전이_없으면_quit_은_바로_차례로_닫는다() {
        let mut q = UpdateQuit::default();
        assert_eq!(q.quit(), OnQuit::CloseAll);
        q.set_pending("main", true);
        q.set_pending("main", false);
        assert_eq!(q.quit(), OnQuit::CloseAll);
    }

    #[test]
    fn 새_버전이_있으면_알린_창에_먼저_묻는다() {
        let mut q = UpdateQuit::default();
        q.set_pending("main", true);
        let OnQuit::Ask(label, id) = q.quit() else {
            panic!()
        };
        assert_eq!(label, "main");
        assert!(q.ack(id));
        assert!(!q.timed_out(id));
        // 다른 창이 「없다」고 해도 알린 창의 것은 지우지 않는다
        q.done();
        q.set_pending("solo-a", false);
        assert!(matches!(q.quit(), OnQuit::Ask(..)));
    }

    #[test]
    fn 화면이_답하지_않으면_묻지_않고_차례로_닫고_늦은_답은_묻지_않게_한다() {
        let mut q = UpdateQuit::default();
        q.set_pending("main", true);
        let OnQuit::Ask(_, id) = q.quit() else {
            panic!()
        };
        // 답을 기다리는 동안 또 누른 Quit 은 기다린다
        assert_eq!(q.quit(), OnQuit::Wait);
        assert!(q.timed_out(id));
        assert!(!q.ack(id));
    }

    #[test]
    fn 묻는_중_또_누른_quit_은_답을_다시_확인하되_물음을_겹치지_않는다() {
        let mut q = UpdateQuit::default();
        q.set_pending("main", true);
        let OnQuit::Ask(_, a) = q.quit() else {
            panic!()
        };
        assert!(q.ack(a));
        let OnQuit::Ask(_, b) = q.quit() else {
            panic!()
        };
        assert!(!q.ack(b));
        // 묻다가 멈춘 창이면 답이 없어 차례로 넘어간다
        let OnQuit::Ask(_, c) = q.quit() else {
            panic!()
        };
        assert!(q.timed_out(c));
        // 묻기를 끝내면(취소) 다음 Quit 에 다시 묻는다
        let OnQuit::Ask(_, d) = q.quit() else {
            panic!()
        };
        assert!(q.ack(d));
        q.done();
        let OnQuit::Ask(_, e) = q.quit() else {
            panic!()
        };
        assert!(q.ack(e));
    }

    #[test]
    fn 알린_창이_다시_로드되거나_사라지면_묻지_않는다() {
        let mut q = UpdateQuit::default();
        q.set_pending("main", true);
        q.gone("solo-a");
        assert!(matches!(q.quit(), OnQuit::Ask(..)));
        let mut q = UpdateQuit::default();
        q.set_pending("main", true);
        let OnQuit::Ask(_, id) = q.quit() else {
            panic!()
        };
        q.gone("main");
        // 기다리던 요청은 시간이 지나면 차례로 간다(Quit 을 누른 것은 그대로다)
        assert!(q.timed_out(id));
        assert_eq!(q.quit(), OnQuit::CloseAll);
    }

    #[test]
    fn 묻던_창이_다시_로드되면_새_페이지가_알린_뒤의_quit_에_다시_묻는다() {
        // 묻는 중(asking)이 남으면 새 페이지의 ack 가 false 라 묻지도, 시한으로 차례로 가지도 않아 Quit 이 아무 일도 하지 않는다
        let mut q = UpdateQuit::default();
        q.set_pending("main", true);
        let OnQuit::Ask(_, id) = q.quit() else {
            panic!()
        };
        assert!(q.ack(id));
        q.gone("main");
        q.set_pending("main", true);
        let OnQuit::Ask(_, id) = q.quit() else {
            panic!()
        };
        assert!(q.ack(id));
    }
}
