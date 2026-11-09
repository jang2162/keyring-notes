/** @excalidraw/mermaid-to-excalidraw 대신(gzip 약 1MB — 위젯 묶음에 싣지 않는다). Mermaid 붙여넣기·변환은 이 위젯에서 쓰지 않는다 */
export async function parseMermaidToExcalidraw(): Promise<never> {
  throw new Error("Mermaid is not available in this widget");
}
