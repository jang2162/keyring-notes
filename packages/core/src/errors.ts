/** 로컬 볼트·동기화가 내는 오류. 웹 화면은 서버 응답과 같은 상태 코드(404·403·409)로 바꿔 보여 준다. */
export class NotFoundError extends Error {}

export class ForbiddenError extends Error {}

/** baseHash가 현재 내용과 다름. currentHash가 null이면 지금은 문서가 없다. */
export class ConflictError extends Error {
  constructor(
    readonly currentHash: string | null,
    message = currentHash === null ? "문서가 이미 없거나 다른 곳에서 지워졌습니다" : "다른 곳에서 먼저 수정되었습니다",
  ) {
    super(message);
  }
}

/** 서버가 기기 토큰을 받지 않음(끊었거나 잘못됨). 다시 연결해야 한다. */
export class UnauthorizedError extends Error {}
