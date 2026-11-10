import { ApiError, type VaultApi } from "../api";
import { DataFileError, type DataFileIO } from "./dataFile";

/** 서버·기기 볼트 API(같은 VaultApi) 위의 데이터 파일 입출력. 쓰기는 첨부 교체(해시 검사) — 덮어쓰지 않는다 */
export function apiDataFileIO(a: Pick<VaultApi, "readBytes" | "replaceAttachment" | "uploadAttachment">): DataFileIO {
  const fail = (e: unknown, on409: "conflict" | "exists"): DataFileError => {
    if (e instanceof ApiError) {
      if (e.status === 409) return new DataFileError(on409);
      if (e.status === 404) return new DataFileError("missing");
    }
    // 네트워크·오프라인·5xx — 바이트를 지우지 않고 다음에 다시 쓴다(dataFile.ts)
    return new DataFileError("failed");
  };
  // Blob 생성자의 타입이 ArrayBuffer 뒤 바이트만 받는다 — 사본으로 넘긴다
  const blob = (bytes: Uint8Array) => new Blob([bytes.slice()]);
  return {
    async read(path) {
      try {
        return await a.readBytes(path);
      } catch (e) {
        throw fail(e, "conflict");
      }
    },
    async replace(path, bytes, baseHash) {
      try {
        const r = await a.replaceAttachment(path, blob(bytes), baseHash);
        return { hash: r.hash };
      } catch (e) {
        throw fail(e, "conflict");
      }
    },
    async create(path, bytes) {
      try {
        return (await a.uploadAttachment(path, blob(bytes))).path;
      } catch (e) {
        throw fail(e, "exists");
      }
    },
  };
}
