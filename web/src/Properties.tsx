import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  BUILTIN_FIELDS,
  convertProperty,
  parseFrontmatter,
  propertyType,
  renameFrontmatterField,
  setFrontmatterField,
  type PropertyStat,
  type PropertyType,
} from "@keyring-notes/core";

/**
 * 속성(프런트매터) 입력 화면. 원문 YAML을 고치지 않고도 필드를 종류에 맞는 입력칸으로 고친다.
 * 고친 결과는 편집 중인 초안에만 들어가고(저장해야 반영), 다른 필드의 순서·주석·모양은 그대로 둔다.
 * YAML이 깨져 있으면 아무것도 고치지 않고 원문에서 고치라고 알린다.
 */

const TYPE_LABEL: Record<PropertyType, string> = {
  text: "글",
  number: "숫자",
  checkbox: "체크",
  date: "날짜",
  datetime: "날짜·시간",
  list: "목록",
  object: "객체",
};
const EDITABLE_TYPES: PropertyType[] = ["text", "number", "checkbox", "date", "datetime", "list"];

interface Props {
  content: string;
  /** 바뀐 문서 전체(초안)를 넘긴다 */
  onChange: (next: string) => void;
  stats: PropertyStat[];
  readOnly?: boolean;
}

export function Properties({ content, onChange, stats, readOnly }: Props) {
  const fm = useMemo(() => parseFrontmatter(content), [content]);
  const [error, setError] = useState<string | null>(null);
  // 값이 비어 종류를 알 수 없는 필드에 사람이 고른 종류
  const [chosen, setChosen] = useState<Record<string, PropertyType>>({});
  const [newKey, setNewKey] = useState("");
  const statOf = useMemo(() => new Map(stats.map((s) => [s.key, s])), [stats]);

  const apply = (fn: (c: string) => string) => {
    try {
      const next = fn(content);
      setError(null);
      if (next !== content) onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (fm.error) return <div className="properties"><p className="prop-error">프런트매터 YAML 오류: {fm.error} — 원문에서 고치세요.</p></div>;
  const entries = Object.entries(fm.data ?? {});
  const typeOf = (key: string, value: unknown): PropertyType => propertyType(value) ?? chosen[key] ?? statOf.get(key)?.type ?? "text";

  const set = (key: string, value: unknown) => apply((c) => setFrontmatterField(c, key, value, { keepEmpty: true }));
  const remove = (key: string) => apply((c) => setFrontmatterField(c, key, null));
  const rename = (from: string, to: string) => {
    const t = to.trim();
    if (!t || t === from) return;
    apply((c) => renameFrontmatterField(c, from, t));
  };
  const add = () => {
    const key = newKey.trim();
    if (!key) return;
    if (fm.data && key in fm.data) return setError(`이미 있는 속성입니다: ${key}`);
    const type = statOf.get(key)?.type ?? "text";
    setChosen((c) => ({ ...c, [key]: type }));
    const empty = type === "checkbox" ? false : type === "list" ? [] : type === "date" || type === "datetime" ? convertProperty(null, type) : null;
    apply((c) => setFrontmatterField(c, key, empty, { keepEmpty: true }));
    setNewKey("");
  };

  return (
    <div className="properties">
      {entries.length === 0 && <p className="meta">속성이 없습니다.</p>}
      {entries.length > 0 && (
        <table>
          <tbody>
            {entries.map(([key, value]) => {
              const type = typeOf(key, value);
              return (
                <tr key={key}>
                  <th>
                    <input
                      className="prop-key"
                      defaultValue={key}
                      key={key}
                      disabled={readOnly}
                      aria-label={`속성 이름 ${key}`}
                      title={BUILTIN_FIELDS.has(key) ? "위젯이 따로 계산하는 이름과 같습니다(위젯에서는 계산한 값이 보입니다)" : undefined}
                      onBlur={(e) => rename(key, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                  </th>
                  <td className="prop-type">
                    {type === "object" ? (
                      <span className="meta">{TYPE_LABEL.object}</span>
                    ) : (
                      <select
                        value={type}
                        disabled={readOnly}
                        aria-label={`${key}의 종류`}
                        onChange={(e) => {
                          const to = e.target.value as PropertyType;
                          setChosen((c) => ({ ...c, [key]: to }));
                          set(key, convertProperty(value, to));
                        }}
                      >
                        {EDITABLE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {TYPE_LABEL[t]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="prop-value">
                    <ValueInput name={key} type={type} value={value} suggestions={statOf.get(key)?.values ?? []} readOnly={readOnly} onSet={(v) => set(key, v)} />
                  </td>
                  <td>
                    {!readOnly && (
                      <button className="link-btn" title={`${key} 지우기`} aria-label={`${key} 지우기`} onClick={() => remove(key)}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!readOnly && (
        <div className="prop-add">
          <input
            list="prop-keys"
            placeholder="속성 더하기"
            aria-label="더할 속성 이름"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <button onClick={add} disabled={!newKey.trim()}>
            더하기
          </button>
          <datalist id="prop-keys">
            {stats
              .filter((s) => !(fm.data && s.key in fm.data))
              .slice(0, 100)
              .map((s) => (
                <option key={s.key} value={s.key}>
                  {`${TYPE_LABEL[s.type]} · ${s.count}`}
                </option>
              ))}
          </datalist>
        </div>
      )}
      {error && <p className="prop-error">{error}</p>}
    </div>
  );
}

function ValueInput({ name, type, value, suggestions, readOnly, onSet }: { name: string; type: PropertyType; value: unknown; suggestions: string[]; readOnly?: boolean; onSet: (v: unknown) => void }) {
  const listId = `prop-values-${name.replace(/[^\w가-힣-]/g, "_")}`;
  const options = suggestions.length > 0 && (
    <datalist id={listId}>
      {suggestions.map((v) => (
        <option key={v} value={v} />
      ))}
    </datalist>
  );
  const commitText = (raw: string, conv: (s: string) => unknown) => {
    const next = raw.trim() === "" ? null : conv(raw.trim());
    if (next !== value) onSet(next);
  };
  const enterBlurs = (e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && (e.target as HTMLInputElement).blur();

  switch (type) {
    case "checkbox":
      return <input type="checkbox" checked={value === true} disabled={readOnly} aria-label={name} onChange={(e) => onSet(e.target.checked)} />;
    case "number":
      return (
        <input
          type="number"
          step="any"
          key={String(value)}
          defaultValue={typeof value === "number" ? value : ""}
          disabled={readOnly}
          aria-label={name}
          onBlur={(e) => commitText(e.target.value, Number)}
          onKeyDown={enterBlurs}
        />
      );
    case "date":
    case "datetime":
      return (
        <input
          type={type === "date" ? "date" : "datetime-local"}
          value={typeof value === "string" ? value.replace(" ", "T") : ""}
          disabled={readOnly}
          aria-label={name}
          onChange={(e) => onSet(e.target.value || null)}
        />
      );
    case "list":
      return <ListInput name={name} items={Array.isArray(value) ? value.map(String) : []} listId={listId} options={options} readOnly={readOnly} onSet={onSet} />;
    case "object":
      return <code className="prop-object">{JSON.stringify(value)}</code>;
    default:
      return (
        <>
          <input
            type="text"
            key={String(value ?? "")}
            defaultValue={value === null || value === undefined ? "" : String(value)}
            list={suggestions.length ? listId : undefined}
            disabled={readOnly}
            aria-label={name}
            onBlur={(e) => commitText(e.target.value, (s) => s)}
            onKeyDown={enterBlurs}
          />
          {options}
        </>
      );
  }
}

function ListInput({ name, items, listId, options, readOnly, onSet }: { name: string; items: string[]; listId: string; options: ReactNode; readOnly?: boolean; onSet: (v: unknown) => void }) {
  const [draft, setDraft] = useState("");
  const push = () => {
    const add = draft
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !items.includes(s));
    setDraft("");
    if (add.length) onSet([...items, ...add]);
  };
  return (
    <div className="prop-list">
      {items.map((it, i) => (
        <span key={`${i}:${it}`} className="prop-chip">
          {it}
          {!readOnly && (
            <button aria-label={`${it} 빼기`} onClick={() => onSet(items.filter((_, j) => j !== i))}>
              ×
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <>
          <input
            value={draft}
            list={options ? listId : undefined}
            placeholder="더하기"
            aria-label={`${name}에 더하기`}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={push}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                push();
              } else if (e.key === "Backspace" && draft === "" && items.length) {
                onSet(items.slice(0, -1));
              }
            }}
          />
          {options}
        </>
      )}
    </div>
  );
}
