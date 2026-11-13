/**
 * 글 안의 링크 꼴(`[[위키링크]]`, `[글](주소)`, `<태그>`)을 찾는 스캐너.
 *
 * 정규식으로 찾지 않는 이유: 정규식은 여는 괄호마다 닫는 짝을 찾아 끝까지 갔다가 되돌아온다. 닫는 짝이 없는 여는 괄호가
 * 한 줄에 많으면(`[[` 를 수만 번 붙여 넣은 줄) 길이의 제곱으로 느려져, 색인(analyze)과 이동 때의 링크 고치기(rewriteLinks)가
 * 그 줄 하나에 수십 초씩 멈춘다. 여기서는 닫는 짝의 자리를 한 번만 찾아 두고 여는 자리마다 다시 쓴다.
 *
 * 찾는 범위와 캡처는 각 함수에 적은 정규식과 글자 하나까지 같아야 한다 — `packages/core/test/linkScan.test.ts` 가
 * 그 정규식을 옮겨 두고 견준다. 규칙을 바꾸려면 그 시험의 정규식부터 바꾼다.
 */

const TAB = 9;
const NL = 10;
const CR = 13;
const SPACE = 32;
const BANG = 33;
const DQUOTE = 34;
const SQUOTE = 39;
const LPAREN = 40;
const RPAREN = 41;
const LT = 60;
const GT = 62;
const BACKSLASH = 92;
const RBRACKET = 93;

/** 정규식의 `\s` */
export function isSpaceCode(c: number): boolean {
  if (c === SPACE || (c >= TAB && c <= CR)) return true;
  if (c < 0xa0) return false;
  return (
    c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff
  );
}

/** 정규식의 `.` 이 건너지 못하는 글자(줄 끝 글자) */
export function isLineEndCode(c: number): boolean {
  return c === NL || c === CR || c === 0x2028 || c === 0x2029;
}

/**
 * from 부터 처음 나오는 멈춤 글자의 자리(없으면 글의 길이)를 주는 함수.
 * from 을 줄이지 않고 부르는 동안은 글 전체를 한 번만 훑는다 — 앞선 답이 from 뒤에 있으면 그 답이 그대로 맞기 때문이다.
 * from 을 줄여 부르면 틀린 답이 나온다.
 */
function stopFinder(s: string, isStop: (c: number) => boolean): (from: number) => number {
  let pos = -1;
  return (from) => {
    if (from > pos) {
      pos = Math.min(from, s.length);
      while (pos < s.length && !isStop(s.charCodeAt(pos))) pos++;
    }
    return pos;
  };
}

export interface WikilinkMatch {
  start: number;
  end: number;
  /** 임베드면 `!`, 아니면 빈 글 */
  bang: string;
  target: string;
  /** `#` 을 포함한 제목·블록 부분. 없으면 빈 글 */
  heading: string;
  /** `|` 를 포함한 별칭 부분. 없으면 빈 글 */
  alias: string;
}

/**
 * `/(!?)\[\[([^\]\n|#]*)((?:#[^\]\n|]*)?)((?:\|[^\]\n]*)?)\]\]/g` 의 모든 일치.
 * `[[` 뒤 처음 나오는 `]`·줄바꿈이 `]]` 일 때만 링크다. 그 사이 글은 첫 `#`·`|` 에서 대상·제목·별칭으로 갈린다.
 */
export function wikilinkMatches(s: string): WikilinkMatch[] {
  const out: WikilinkMatch[] = [];
  const close = stopFinder(s, (c) => c === RBRACKET || c === NL);
  let from = 0;
  for (let p = s.indexOf("[[", from); p >= 0; p = s.indexOf("[[", from)) {
    const q = close(p + 2);
    if (s.charCodeAt(q) !== RBRACKET || s.charCodeAt(q + 1) !== RBRACKET) {
      from = p + 1;
      continue;
    }
    let targetEnd = p + 2;
    while (targetEnd < q && s[targetEnd] !== "|" && s[targetEnd] !== "#") targetEnd++;
    let headingEnd = targetEnd;
    if (s[targetEnd] === "#") while (headingEnd < q && s[headingEnd] !== "|") headingEnd++;
    const bang = p > 0 && s.charCodeAt(p - 1) === BANG ? "!" : "";
    out.push({
      start: p - bang.length,
      end: q + 2,
      bang,
      target: s.slice(p + 2, targetEnd),
      heading: s.slice(targetEnd, headingEnd),
      alias: s.slice(headingEnd, q),
    });
    from = q + 2;
  }
  return out;
}

/**
 * `s.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")` — 위키링크를 보이는 글로 바꾼다(`[[대상|별칭]]` → 별칭, `[[대상]]` → 대상).
 * 줄바꿈에서 멈추지 않는 것이 wikilinkMatches 와 다르다(요약은 한 덩어리 글이다).
 */
export function wikilinkLabels(s: string): string {
  const close = stopFinder(s, (c) => c === RBRACKET);
  let out = "";
  let last = 0;
  let from = 0;
  for (let p = s.indexOf("[[", from); p >= 0; p = s.indexOf("[[", from)) {
    const q = close(p + 2);
    if (s.charCodeAt(q) !== RBRACKET || s.charCodeAt(q + 1) !== RBRACKET) {
      from = p + 1;
      continue;
    }
    let bar = p + 2;
    while (bar < q && s[bar] !== "|") bar++;
    out += s.slice(last, p) + s.slice(bar < q ? bar + 1 : p + 2, q);
    last = from = q + 2;
  }
  return last === 0 ? s : out + s.slice(last);
}

export interface MdlinkMatch {
  start: number;
  end: number;
  bang: string;
  label: string;
  /** 주소. `<…>` 로 감쌌으면 꺾쇠까지 */
  url: string;
  /** 제목(앞 공백과 따옴표 포함). 없으면 빈 글 */
  title: string;
}

/**
 * `/(!?)\[((?:[^\]\\\n]|\\.)*)\]\((<[^>\n]*>|[^)\s]+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'))?)\)/g` 의 모든 일치.
 *
 * 선형인 까닭: 같은 `]` 에서 글이 끝나는 `[` 들은 그 뒤(주소·제목)의 답도 같으므로 `]` 마다 한 번만 본다.
 * `[` 가 달라도 글을 읽는 걸음(백슬래시 짝)은 같은 자리에서 맞물리므로, 한 번 읽은 구간 안의 `[` 는 같은 `]` 를 쓴다.
 */
export function mdlinkMatches(s: string): MdlinkMatch[] {
  const out: MdlinkMatch[] = [];
  const n = s.length;
  const gt = stopFinder(s, (c) => c === GT || c === NL);
  const urlEnd = stopFinder(s, (c) => c === RPAREN || isSpaceCode(c));
  // 주소 뒤(자리 r)에서 `)` 까지: 제목이 있으면 그 뒤. 닫히지 않으면 -1. 같은 자리는 한 번만 본다
  const afterUrl = new Map<number, number>();
  const closeAt = (r: number): number => {
    const known = afterUrl.get(r);
    if (known !== undefined) return known;
    let end = -1;
    const c = s.charCodeAt(r);
    if (c === RPAREN) end = r + 1;
    else if (isSpaceCode(c)) {
      let w = r;
      while (w < n && isSpaceCode(s.charCodeAt(w))) w++;
      const quote = s.charCodeAt(w);
      if (quote === DQUOTE || quote === SQUOTE) {
        let k = w + 1;
        while (k < n && s.charCodeAt(k) !== quote && s.charCodeAt(k) !== NL) k++;
        if (s.charCodeAt(k) === quote && s.charCodeAt(k + 1) === RPAREN) end = k + 2;
      }
    }
    afterUrl.set(r, end);
    return end;
  };
  // 글(`[` 다음)이 멈춘 자리와, 거기가 닫는 `]` 인지
  let labelStop = -1;
  let labelClosed = false;
  // 마지막으로 본 `]` 뒤의 답
  let tailOf = -1;
  let tail: { urlEnd: number; end: number } | null = null;
  let from = 0;
  for (let p = s.indexOf("[", from); p >= 0; p = s.indexOf("[", from)) {
    from = p + 1;
    if (p >= labelStop) {
      let i = p + 1;
      labelClosed = false;
      for (;;) {
        const c = s.charCodeAt(i);
        if (i >= n || c === NL) break;
        if (c === RBRACKET) {
          labelClosed = true;
          break;
        }
        if (c === BACKSLASH) {
          if (i + 1 >= n || isLineEndCode(s.charCodeAt(i + 1))) break;
          i += 2;
        } else i++;
      }
      labelStop = i;
    }
    const q = labelStop;
    if (!labelClosed || s.charCodeAt(q + 1) !== LPAREN) continue;
    if (tailOf !== q) {
      tailOf = q;
      tail = null;
      const u = q + 2;
      if (s.charCodeAt(u) === LT) {
        const g = gt(u + 1);
        if (s.charCodeAt(g) === GT) {
          const end = closeAt(g + 1);
          if (end >= 0) tail = { urlEnd: g + 1, end };
        }
      }
      if (!tail) {
        const r = urlEnd(u);
        if (r > u && r < n) {
          const end = closeAt(r);
          if (end >= 0) tail = { urlEnd: r, end };
        }
      }
    }
    if (!tail) continue;
    const bang = p > 0 && s.charCodeAt(p - 1) === BANG ? "!" : "";
    out.push({
      start: p - bang.length,
      end: tail.end,
      bang,
      label: s.slice(p + 1, q),
      url: s.slice(q + 2, tail.urlEnd),
      title: s.slice(tail.urlEnd, tail.end - 1),
    });
    from = tail.end;
  }
  return out;
}

/** `/!?\[[^\]\n]*\]\([^)\n]*\)/g` 의 일치 범위 — 줄 안의 `[글](주소)` 자리(언급을 세지 않을 곳) */
export function inlineLinkRanges(s: string): [number, number][] {
  const out: [number, number][] = [];
  const bracket = stopFinder(s, (c) => c === RBRACKET || c === NL);
  const paren = stopFinder(s, (c) => c === RPAREN || c === NL);
  let from = 0;
  for (let p = s.indexOf("[", from); p >= 0; p = s.indexOf("[", from)) {
    from = p + 1;
    const q = bracket(p + 1);
    if (s.charCodeAt(q) !== RBRACKET || s.charCodeAt(q + 1) !== LPAREN) continue;
    const r = paren(q + 2);
    if (s.charCodeAt(r) !== RPAREN) continue;
    out.push([p > 0 && s.charCodeAt(p - 1) === BANG ? p - 1 : p, r + 1]);
    from = r + 1;
  }
  return out;
}

/** `/<[^>\n]+>/g` 의 일치 범위 — 줄 안의 `<태그>` 자리 */
export function angleRanges(s: string): [number, number][] {
  const out: [number, number][] = [];
  const close = stopFinder(s, (c) => c === GT || c === NL);
  let from = 0;
  for (let p = s.indexOf("<", from); p >= 0; p = s.indexOf("<", from)) {
    from = p + 1;
    const g = close(p + 1);
    if (g === p + 1 || s.charCodeAt(g) !== GT) continue;
    out.push([p, g + 1]);
    from = g + 1;
  }
  return out;
}

/**
 * `/^(\s*)(["']?)(.*?)\2(\s*)$/` 의 캡처 [앞 공백, 따옴표, 값, 뒤 공백]. 일치하지 않으면 null(값 안에 줄 끝 글자가 있을 때).
 * 앞뒤 공백을 떼고, 남은 것이 같은 따옴표로 감싸여 있으면 따옴표를 뗀다.
 */
export function quotedValue(s: string): [string, string, string, string] | null {
  const n = s.length;
  let lead = 0;
  while (lead < n && isSpaceCode(s.charCodeAt(lead))) lead++;
  if (lead === n) return [s, "", "", ""];
  let trail = n;
  while (isSpaceCode(s.charCodeAt(trail - 1))) trail--;
  // 값 안(앞뒤 공백 사이)에서 마지막 줄 끝 글자의 자리
  let lineEnd = -1;
  for (let i = trail - 1; i >= lead; i--)
    if (isLineEndCode(s.charCodeAt(i))) {
      lineEnd = i;
      break;
    }
  const quote = s.charCodeAt(lead);
  if ((quote === DQUOTE || quote === SQUOTE) && trail - 1 > lead && s.charCodeAt(trail - 1) === quote && lineEnd < 0)
    return [s.slice(0, lead), s[lead], s.slice(lead + 1, trail - 1), s.slice(trail)];
  if (lineEnd < 0) return [s.slice(0, lead), "", s.slice(lead, trail), s.slice(trail)];
  return null;
}
