/**
 * 퍼센트 인코딩을 푼다. 잘못된 인코딩(`%E9` 처럼 UTF-8 이 아닌 바이트, 끝이 잘린 `%`)이면 던지지 않고 받은 글 그대로 돌려준다.
 * 노트 내용과 주소(location.hash)에서 온 값은 이것으로 푼다 — decodeURIComponent 가 그리는 길에서 던지면 화면이 통째로 내려간다
 */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
