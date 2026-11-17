// Input corpus for every text box, argument and endpoint: boundaries, empty, huge, unicode/RTL/emoji, injection strings,
// wrong types. Each entry has a class name so coverage can count classes per input.
export const TEXT = [
  ["empty", ""],
  ["spaces", "   \t  "],
  ["one-char", "a"],
  ["normal", "checkout page"],
  ["boundary-40", "x".repeat(40)],
  ["boundary-41", "y".repeat(41)],
  ["long-300", "word ".repeat(60)],
  ["huge-20k", "z".repeat(20_000)],
  ["newlines", "line one\nline two\r\nline three"],
  ["unicode", "café naïve 日本語 中文"],
  ["rtl", "\u202Eevil\u202C مرحبا שלום"],
  ["emoji", "🚀 ship it 👩‍💻🏳️‍🌈"],
  ["zero-width", "a\u200Bb\u200Dc\uFEFF"],
  ["html", "<b>bold</b><img src=x onerror=alert(1)>"],
  ["script", "</script><script>window.__pwned=1</script>"],
  ["attr", "\" onmouseover=\"window.__pwned=1\" x=\""],
  ["shell", "$(touch /tmp/bp-pwned) `id` ; rm -rf ~ && echo"],
  ["apostrophe", "don't break it's fine"],
  ["quotes", "say \"hi\" and 'bye'"],
  ["backslash", "C:\\Users\\x\\file.txt \\\\"],
  ["sql", "x'); DROP TABLE sessions;--"],
  ["like-wild", "%_%\\"],
  ["path-traversal", "../../../../etc/passwd"],
  ["nul", "a\u0000b"],
  ["lone-surrogate", "a\uD800b"],
  ["control", "\u0007\u001b[31mred\u001b[0m"],
  ["json", "{\"type\":\"disconnect\"}"],
  ["number-like", "1e309"],
  ["proto", "__proto__"],
];
/** Wrong types for fields the server reads with String(): objects, arrays, numbers, booleans, null. */
export const WRONG = [["number", 42], ["bool", true], ["null", null], ["array", ["a", "b"]], ["object", { toString: "x", a: 1 }], ["nested", { $gt: "" }]];
/** Raw bodies for POST endpoints. */
export const BODIES = [
  ["empty", ""], ["not-json", "hello"], ["truncated", "{\"type\":\"rename"], ["array", "[1,2,3]"], ["null", "null"], ["number", "7"], ["string", "\"x\""],
  ["deep", "[".repeat(5000) + "]".repeat(5000)], ["big-299k", JSON.stringify({ type: "copy", text: "a".repeat(299_000) })], ["too-big-400k", JSON.stringify({ type: "copy", text: "a".repeat(400_000) })],
  ["unknown-type", "{\"type\":\"nope\"}"], ["proto", "{\"__proto__\":{\"polluted\":1},\"type\":\"ready\"}"], ["bom", "\uFEFF{\"type\":\"ready\"}"],
];
