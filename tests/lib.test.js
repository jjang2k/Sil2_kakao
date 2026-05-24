import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import vm from "node:vm";

// lib.js는 브라우저 <script>로도 동작해야 해서 모듈 문법을 쓰지 않습니다.
// 여기서는 vm.runInContext로 스크립트를 실행해 글로벌이 된 함수를 컨텍스트에서 꺼냅니다.
const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, "../lib.js"), "utf8");
// Date를 공유하지 않으면 vm 컨텍스트의 Date가 별도 realm이 되어
// toBeInstanceOf(Date)가 실패합니다 (cross-realm identity 문제).
const ctx = vm.createContext({ Date });
vm.runInContext(source, ctx);
const { estimateTokens, parseKakaoDate, pad2, fmtShort, mapColumns, escapeHtml } = ctx;

describe("parseKakaoDate", () => {
  it("parses standard KakaoTalk export format", () => {
    const d = parseKakaoDate("2026.4.30 9:53");
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // 0-indexed
    expect(d.getDate()).toBe(30);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(53);
  });

  it("parses zero-padded variants", () => {
    const d = parseKakaoDate("2026.04.05 09:07");
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(5);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(7);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseKakaoDate("  2026.1.1 0:00  ")).toBeInstanceOf(Date);
  });

  it("returns null for non-matching strings", () => {
    expect(parseKakaoDate("2026-04-30 09:53")).toBeNull(); // ISO-ish with dashes
    expect(parseKakaoDate("2026/4/30 9:53")).toBeNull();   // slashes
    expect(parseKakaoDate("4.30 9:53")).toBeNull();        // missing year
    expect(parseKakaoDate("2026.4.30 9:53:01")).toBeNull(); // extra seconds
    expect(parseKakaoDate("")).toBeNull();
    expect(parseKakaoDate("not a date")).toBeNull();
  });

  it("coerces non-string input via String()", () => {
    expect(parseKakaoDate(null)).toBeNull();
    expect(parseKakaoDate(undefined)).toBeNull();
  });
});

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates lower for ASCII-heavy text", () => {
    const ascii = estimateTokens("hello world this is a plain english sentence");
    // 44 chars * 0.4 = ~18
    expect(ascii).toBeGreaterThan(10);
    expect(ascii).toBeLessThan(25);
  });

  it("estimates higher for Korean/CJK-heavy text", () => {
    const korean = estimateTokens("안녕하세요반갑습니다오늘날씨가좋네요");
    // 18 chars, all Hangul → ~0.9-1.0 per char → ~17
    expect(korean).toBeGreaterThan(14);
    expect(korean).toBeLessThanOrEqual(18);
  });

  it("scales with length", () => {
    const short = estimateTokens("hello");
    const long = estimateTokens("hello".repeat(100));
    expect(long).toBeGreaterThan(short * 50);
  });
});

describe("pad2", () => {
  it("zero-pads single digits", () => {
    expect(pad2(0)).toBe("00");
    expect(pad2(5)).toBe("05");
    expect(pad2(9)).toBe("09");
  });

  it("does not pad double digits", () => {
    expect(pad2(10)).toBe("10");
    expect(pad2(59)).toBe("59");
  });
});

describe("fmtShort", () => {
  it("formats Date as MM.DD HH:mm", () => {
    expect(fmtShort(new Date(2026, 3, 5, 9, 7))).toBe("04.05 09:07");
    expect(fmtShort(new Date(2026, 11, 31, 23, 59))).toBe("12.31 23:59");
  });
});

describe("mapColumns", () => {
  it("matches English headers", () => {
    expect(mapColumns(["Date", "User", "Message"])).toEqual({
      date: "Date",
      user: "User",
      message: "Message",
    });
  });

  it("matches Korean headers", () => {
    expect(mapColumns(["날짜", "이름", "메시지"])).toEqual({
      date: "날짜",
      user: "이름",
      message: "메시지",
    });
  });

  it("matches case-insensitively and tolerates column order", () => {
    expect(mapColumns(["MESSAGE", "DATE", "SENDER"])).toEqual({
      date: "DATE",
      user: "SENDER",
      message: "MESSAGE",
    });
  });

  it("falls back to positional columns when no semantic match", () => {
    // 알려진 함정: 의미 매칭 실패 시 조용히 첫 3개 컬럼으로 폴백.
    // 호출부에서 추가 검증을 하지 않으면 잘못된 컬럼이 그대로 사용됩니다.
    expect(mapColumns(["foo", "bar", "baz"])).toEqual({
      date: "foo",
      user: "bar",
      message: "baz",
    });
  });

  it("partial match falls back to positional for missing fields", () => {
    expect(mapColumns(["Date", "x", "y"])).toEqual({
      date: "Date",
      user: "x",
      message: "y",
    });
  });
});

describe("escapeHtml", () => {
  it("escapes the four HTML-significant characters", () => {
    expect(escapeHtml("<script>alert('xss')</script>"))
      .toBe("&lt;script&gt;alert('xss')&lt;/script&gt;");
    expect(escapeHtml('"quoted"')).toBe("&quot;quoted&quot;");
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes ampersand first (no double-escaping)", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("coerces null/undefined to empty string", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("passes through safe text unchanged", () => {
    expect(escapeHtml("안녕하세요 123 hello")).toBe("안녕하세요 123 hello");
  });
});
