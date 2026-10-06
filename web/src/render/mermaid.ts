// Mermaid 렌더러. 크기가 커서(수 MB) 다이어그램이 있는 문서를 열 때만 불러온다.
import mermaid from "mermaid";

let theme: string | null = null;
let seq = 0;

export async function renderMermaid(src: string, dark: boolean): Promise<string> {
  const want = dark ? "dark" : "default";
  if (theme !== want) {
    mermaid.initialize({
      startOnLoad: false,
      // strict: 라벨의 HTML을 그대로 넣지 않고, 클릭 이벤트·스크립트를 막는다
      securityLevel: "strict",
      theme: want,
      // 라벨을 foreignObject(HTML) 대신 SVG 글자로: SVG만 허용하는 정화를 통과하게
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      fontFamily: "system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
    });
    theme = want;
  }
  const id = `kn-mermaid-${++seq}`;
  try {
    const { svg } = await mermaid.render(id, src);
    return svg;
  } finally {
    // 오류가 나면 mermaid가 본문에 남기는 임시 요소를 치운다
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}
