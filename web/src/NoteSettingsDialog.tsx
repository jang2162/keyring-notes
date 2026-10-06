import { useState, type FormEvent } from "react";
import { dailyNotePath } from "@keyring-notes/core";
import { DEFAULT_NOTE_SETTINGS, type NoteSettings } from "./noteSettings";

export function NoteSettingsDialog({ value, onSave, onClose }: { value: NoteSettings; onSave: (s: NoteSettings) => void; onClose: () => void }) {
  const [s, setS] = useState(value);
  const set = (k: keyof NoteSettings) => (e: { target: { value: string } }) => setS((v) => ({ ...v, [k]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(s);
    onClose();
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal note-settings" onSubmit={submit} role="dialog" aria-label="데일리 노트·템플릿 설정">
        <div className="modal-head">
          <strong>데일리 노트·템플릿</strong>
          <button type="button" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <label>
          데일리 노트 폴더
          <input value={s.dailyFolder} onChange={set("dailyFolder")} placeholder="일기" />
        </label>
        <label>
          파일 이름 형식 <span className="meta">YYYY MM DD ddd(요일) · /로 하위 폴더</span>
          <input value={s.dailyFormat} onChange={set("dailyFormat")} placeholder="YYYY-MM-DD" />
        </label>
        <p className="meta">오늘: {dailyNotePath(s.dailyFolder, s.dailyFormat, new Date())}</p>
        <label>
          데일리 노트 템플릿 문서
          <input value={s.dailyTemplate} onChange={set("dailyTemplate")} placeholder="템플릿/데일리.md" />
        </label>
        <label>
          템플릿 폴더
          <input value={s.templateFolder} onChange={set("templateFolder")} placeholder="템플릿" />
        </label>
        <p className="meta">
          템플릿 변수: {"{{title}} {{date}} {{time}} {{date:YYYY년 M월 D일 dddd}} {{yesterday}} {{tomorrow}}"}
        </p>
        <div className="ask-actions">
          <button type="button" onClick={() => setS(DEFAULT_NOTE_SETTINGS)}>
            기본값
          </button>
          <button type="submit" className="on">
            저장
          </button>
        </div>
      </form>
    </div>
  );
}
