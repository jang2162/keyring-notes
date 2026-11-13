import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "./i18n";

interface Props {
  /** 그리는 노트(경로 등). 이것이나 source 가 바뀌면 대체 화면을 풀고 다시 그려 본다 */
  resetKey: string;
  /** 노트 원문. 대체 화면에 글자 그대로 보인다 */
  source: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
  /** 마지막으로 본 resetKey·source. 큰 노트에서 입력마다 글을 이어 붙이지 않게 둘을 따로 견준다 */
  key: string;
  source: string;
}

/**
 * 노트를 그리다(렌더·그 뒤의 effect) 던진 예외를 이 자리에서 멈춘다. 경계가 없으면 예외가 React 루트까지 올라가
 * 화면이 통째로 내려가고, 다른 탭의 저장 안 한 초안도 함께 사라진다. 배치가 그 탭과 보기 모드를 기억하므로 새로 고쳐도 다시 죽는다.
 *
 * 노트 내용은 신뢰할 수 없는 입력(에이전트가 쓴 노트, 클립한 웹 문서)이라 렌더러가 던지는 일을 없앨 수는 없다 —
 * 던졌을 때 안내와 원문, 다시 시도 단추를 보인다. 같은 대상이면 부모가 다시 그려도 풀지 않는다(실패한 렌더를 입력마다 되풀이하지 않게).
 */
export class RenderBoundary extends Component<Props, State> {
  state: State = { failed: false, key: this.props.resetKey, source: this.props.source };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.key && props.source === state.source) return null;
    return { failed: false, key: props.resetKey, source: props.source };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("keyring: note render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="render-failed">
        <div className="render-failed-head">
          <p role="alert">{t("doc.renderFailed")}</p>
          <button type="button" onClick={() => this.setState({ failed: false })}>
            {t("common.retry")}
          </button>
        </div>
        <pre>{this.props.source}</pre>
      </div>
    );
  }
}
