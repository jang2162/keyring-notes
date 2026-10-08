import { describe, expect, it } from "vitest";
import { isRecordOf, isString, isStringArray, readStored } from "./stored";

describe("이 기기 저장값 읽기", () => {
  const tabs = isRecordOf(isStringArray);

  it("모양이 맞으면 그 값을 쓴다", () => {
    expect(readStored('{"업무":["업무/a.md"]}', {}, tabs)).toEqual({ 업무: ["업무/a.md"] });
    expect(readStored('["a.md"]', [], isStringArray)).toEqual(["a.md"]);
    expect(readStored('{"개인":"개인/b.md"}', {}, isRecordOf(isString))).toEqual({ 개인: "개인/b.md" });
  });

  it("없거나 JSON이 아니면 기본값", () => {
    expect(readStored(null, {}, tabs)).toEqual({});
    expect(readStored("{깨짐", [], isStringArray)).toEqual([]);
  });

  it("예전 형식(탭 배열)처럼 모양이 다르면 기본값으로 시작한다", () => {
    // 3차 전에는 keyring:tabs가 경로 배열이었다
    expect(readStored('["a.md","b.md"]', {}, tabs)).toEqual({});
    expect(readStored('{"업무":"a.md"}', {}, tabs)).toEqual({});
    expect(readStored('{"업무":[1,2]}', {}, tabs)).toEqual({});
    expect(readStored("null", {}, tabs)).toEqual({});
    expect(readStored('{"a":1}', [], isStringArray)).toEqual([]);
  });
});
