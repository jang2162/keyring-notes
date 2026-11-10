declare module "virtual:widget-frames" {
  /** "runtime", (개발) "dday", "excalidraw" — 값은 /widget-frame/ 주소(web/frameBuild.ts) */
  const frames: Record<string, import("./widgetFrames").FrameManifestEntry>;
  export default frames;
}
