/**
 * 이 기기 저장소(IndexedDB) 보존 요청. 보존되지 않은 저장소는 기기 공간이 부족할 때 브라우저가 지울 수 있고,
 * 그러면 브라우저 로컬 볼트와 서버로 보내지 못한 오프라인 대기분이 함께 사라진다.
 */

type Manager = Pick<StorageManager, "persist" | "persisted">;

/**
 * 보존을 요청하고 지금 보존되는지 돌려준다(API 가 없거나 실패하면 null).
 * 페이지 로드마다 많아야 한 번 묻는다 — Firefox 는 물을 때마다 사람에게 창을 띄운다. 이미 보존되면 묻지 않는다.
 */
export function persistRequester(manager: () => Manager | undefined): () => Promise<boolean | null> {
  let asked: Promise<boolean | null> | null = null;
  return () => {
    asked ??= (async () => {
      // API 가 없는 브라우저(navigator.storage·persist 없음)는 여기서 TypeError 가 나 null 로 끝난다
      const m = manager()!;
      if (await m.persisted()) return true;
      return m.persist();
    })().catch(() => null);
    return asked;
  };
}

export const requestPersist = persistRequester(() => (typeof navigator === "undefined" ? undefined : navigator.storage));
