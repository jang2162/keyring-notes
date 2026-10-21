// vite.config.ts 의 emojiData 플러그인이 만드는 이모지 목록
declare module "virtual:emoji-data" {
  const catalog: import("./emojiCatalog").Catalog;
  export default catalog;
}
