import type { FileStore } from "@keyring-notes/core";
import { requestPersist } from "../persist";
import { IdbStore } from "./idbStore";

/** 브라우저 로컬 볼트의 저장소(IndexedDB). 볼트가 이 기기에만 있으므로 열 때 저장소 보존을 청한다(persist.ts) */
export function openBrowserStore(): FileStore {
  void requestPersist();
  return new IdbStore();
}
