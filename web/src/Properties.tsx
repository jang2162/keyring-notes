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
import { SmilePlus } from "lucide-react";
import { confirmDialog } from "./dialog";
import { fmtNumber, t } from "./i18n";
import { errorText } from "./toast";
import { tipProps } from "./Tooltip";

/**
 * 속성(프런트매터) 입력 화면. 원문 YAML을 고치지 않고도 필드를 종류에 맞는 입력칸으로 고친다.
 * 고친 결과는 편집 중인 초안에만 들어가고(저장해야 반영), 다른 필드의 순서·주석·모양은 그대로 둔다.
 * YAML이 깨져 있으면 아무것도 고치지 않고 원문에서 고치라고 알린다.
 */

const typeLabel = (type: PropertyType) => t(`props.type.${type}`);
const EDITABLE_TYPES: PropertyType[] = ["text", "number", "checkbox", "date", "datetime", "list"];

interface Props {
  content: string;
  /** 바뀐 문서 전체(초안)를 넘긴다 */
  onChange: (next: string) => void;
  stats: PropertyStat[];
  readOnly?: boolean;
  /** 주면 icon 속성 값을 이모지 고르기 단추로 보인다(누른 자리 아래에 고르기 창) */
  onPickIcon?: (at: { x: number; y: number }) => void;
}

export function Properties({ content, onChange, stats, readOnly, onPickIcon }: Props) {
  const fm = useMemo(() => parseFrontmatter(content), [content]);
  const [error, setError] = useState<string | null>(null);
  // 값이 비어 종류를 알 수 없는 필드에 사람이 고른 종류
  const [chosen, setChosen] = useState<Record<string, PropertyType>>({});
  const [newKey, setNewKey] = useState("");
  // 속성이 없는 문서는 "속성 더하기" 단추만 보이고, 누르면 입력칸을 연다
  const [adding, setAdding] = useState(false);
  const statOf = useMemo(() => new Map(stats.map((s) => [s.key, s])), [stats]);

  const apply = (fn: (c: string) => string) => {
    try {
      const next = fn(content);
      setError(null);
      if (next !== content) onChange(next);
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (fm.error)
    return (
      <div className="properties">
        <p className="prop-error">{t("props.yamlError", { error: fm.error })}</p>
      </div>
    );
  const entries = Object.entries(fm.data ?? {});
  const typeOf = (key: string, value: unknown): PropertyType => propertyType(value) ?? chosen[key] ?? statOf.get(key)?.type ?? "text";

  const set = (key: string, value: unknown) => apply((c) => setFrontmatterField(c, key, value, { keepEmpty: true }));
  const remove = async (key: string) => {
    if (await confirmDialog(t("props.removeAsk", { key }), t("common.delete"))) apply((c) => setFrontmatterField(c, key, null));
  };
  const rename = (from: string, to: string) => {
    const name = to.trim();
    if (!name || name === from) return;
    apply((c) => renameFrontmatterField(c, from, name));
  };
  const add = () => {
    const key = newKey.trim();
    if (!key) return;
    if (fm.data && key in fm.data) return setError(t("props.exists", { key }));
    const type = statOf.get(key)?.type ?? "text";
    setChosen((c) => ({ ...c, [key]: type }));
    const empty = type === "checkbox" ? false : type === "list" ? [] : type === "date" || type === "datetime" ? convertProperty(null, type) : null;
    apply((c) => setFrontmatterField(c, key, empty, { keepEmpty: true }));
    setNewKey("");
  };

  if (entries.length === 0 && !adding) {
    if (readOnly) return null;
    return (
      <div className="properties properties-empty">
        <button className="prop-add-btn" onClick={() => setAdding(true)}>
          ＋ {t("props.add")}
        </button>
      </div>
    );
  }

  return (
    <div className="properties">
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
                      aria-label={t("props.nameLabel", { key })}
                      title={BUILTIN_FIELDS.has(key) ? t("props.builtinTip") : undefined}
                      onBlur={(e) => rename(key, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                  </th>
                  <td className="prop-type">
                    {type === "object" ? (
                      <span className="meta">{typeLabel("object")}</span>
                    ) : (
                      <select
                        value={type}
                        disabled={readOnly}
                        aria-label={t("props.typeLabel", { key })}
                        onChange={(e) => {
                          const to = e.target.value as PropertyType;
                          setChosen((c) => ({ ...c, [key]: to }));
                          set(key, convertProperty(value, to));
                        }}
                      >
                        {EDITABLE_TYPES.map((ty) => (
                          <option key={ty} value={ty}>
                            {typeLabel(ty)}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="prop-value">
                    {key === "icon" && onPickIcon && !readOnly && (value === null || typeof value === "string") ? (
                      <button
                        type="button"
                        className="prop-icon-btn"
                        {...tipProps({ label: value ? t("title.changeIcon") : t("title.addIcon") })}
                        aria-label={value ? t("title.changeIconOf", { icon: value }) : t("title.addIcon")}
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          onPickIcon({ x: r.left, y: r.bottom + 4 });
                        }}
                      >
                        {value || <SmilePlus size={16} strokeWidth={1.75} aria-hidden />}
                      </button>
                    ) : (
                      <ValueInput
                        name={key}
                        type={type}
                        value={value}
                        suggestions={statOf.get(key)?.values ?? []}
                        readOnly={readOnly}
                        onSet={(v) => set(key, v)}
                      />
                    )}
                  </td>
                  <td>
                    {!readOnly && (
                      <button
                        className="link-btn"
                        {...tipProps({ label: t("props.removeTip", { key }) })}
                        aria-label={t("props.removeTip", { key })}
                        onClick={() => void remove(key)}
                      >
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
            autoFocus={adding && entries.length === 0}
            onBlur={() => !newKey.trim() && setAdding(false)}
            placeholder={t("props.add")}
            aria-label={t("props.newNameLabel")}
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
            {t("props.addButton")}
          </button>
          <datalist id="prop-keys">
            {stats
              .filter((s) => !(fm.data && s.key in fm.data))
              .slice(0, 100)
              .map((s) => (
                <option key={s.key} value={s.key}>
                  {`${typeLabel(s.type)} · ${fmtNumber(s.count)}`}
                </option>
              ))}
          </datalist>
        </div>
      )}
      {error && <p className="prop-error">{error}</p>}
    </div>
  );
}

function ValueInput({
  name,
  type,
  value,
  suggestions,
  readOnly,
  onSet,
}: {
  name: string;
  type: PropertyType;
  value: unknown;
  suggestions: string[];
  readOnly?: boolean;
  onSet: (v: unknown) => void;
}) {
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
      return (
        <ListInput name={name} items={Array.isArray(value) ? value.map(String) : []} listId={listId} options={options} readOnly={readOnly} onSet={onSet} />
      );
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

function ListInput({
  name,
  items,
  listId,
  options,
  readOnly,
  onSet,
}: {
  name: string;
  items: string[];
  listId: string;
  options: ReactNode;
  readOnly?: boolean;
  onSet: (v: unknown) => void;
}) {
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
            <button
              aria-label={t("props.removeItem", { item: it })}
              {...tipProps({ label: t("props.removeItem", { item: it }) })}
              onClick={() => onSet(items.filter((_, j) => j !== i))}
            >
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
            placeholder={t("props.addButton")}
            aria-label={t("props.addTo", { name })}
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
