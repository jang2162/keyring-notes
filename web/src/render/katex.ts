// 수식 렌더러. 처음 수식이 보일 때만 불러온다(글꼴·CSS 포함, 같은 출처의 번들 자산이라 오프라인·앱에서도 된다).
import katex from "katex";
import "katex/dist/katex.min.css";

export function renderTex(tex: string, display: boolean): string {
  // trust: false — \href·\url·\includegraphics 같은 위험한 명령은 그리지 않는다
  return katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, strict: "ignore", output: "htmlAndMathml" });
}
