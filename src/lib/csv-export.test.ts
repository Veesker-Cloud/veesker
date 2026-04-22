import { describe, it, expect } from "vitest";
import { toCsv, toJson } from "./csv-export";

describe("toCsv", () => {
  it("empty rows — header only", () => {
    const result = toCsv(["ID", "NAME"], []);
    expect(result).toBe("ID,NAME\r\n");
  });

  it("simple row, no quoting needed", () => {
    const result = toCsv(["ID", "NAME"], [[1, "Alice"]]);
    expect(result).toBe("ID,NAME\r\n1,Alice\r\n");
  });

  it("field containing comma → quoted", () => {
    const result = toCsv(["NAME"], [["Smith, John"]]);
    expect(result).toBe('NAME\r\n"Smith, John"\r\n');
  });

  it("field containing double-quote → doubled inside quotes", () => {
    const result = toCsv(["QUOTE"], [['say "hello"']]);
    expect(result).toBe('QUOTE\r\n"say ""hello"""\r\n');
  });

  it("field containing newline → quoted", () => {
    const result = toCsv(["NOTE"], [["line1\nline2"]]);
    expect(result).toBe('NOTE\r\n"line1\nline2"\r\n');
  });

  it("field containing \\r\\n → quoted", () => {
    const result = toCsv(["NOTE"], [["line1\r\nline2"]]);
    expect(result).toBe('NOTE\r\n"line1\r\nline2"\r\n');
  });

  it("null → empty string", () => {
    const result = toCsv(["A", "B"], [[null, undefined]]);
    expect(result).toBe("A,B\r\n,\r\n");
  });

  it("number → string representation", () => {
    const result = toCsv(["NUM"], [[42.5]]);
    expect(result).toBe("NUM\r\n42.5\r\n");
  });

  it("boolean → true/false", () => {
    const result = toCsv(["FLAG"], [[true], [false]]);
    expect(result).toBe("FLAG\r\ntrue\r\nfalse\r\n");
  });

  it("multiple rows — correct CRLF between each, trailing CRLF at end", () => {
    const result = toCsv(["A"], [["x"], ["y"], ["z"]]);
    expect(result).toBe("A\r\nx\r\ny\r\nz\r\n");
    expect(result.endsWith("\r\n")).toBe(true);
    // count occurrences of \r\n
    const matches = result.match(/\r\n/g);
    expect(matches?.length).toBe(4); // header + 3 rows
  });

  it("Date → ISO string", () => {
    const d = new Date("2024-01-15T10:30:00.000Z");
    const result = toCsv(["DT"], [[d]]);
    expect(result).toBe("DT\r\n2024-01-15T10:30:00.000Z\r\n");
  });

  it("column header containing comma → quoted", () => {
    const result = toCsv(["A,B"], [[1]]);
    expect(result).toBe('"A,B"\r\n1\r\n');
  });
});

describe("toJson", () => {
  it("empty rows → empty array", () => {
    const result = toJson(["ID", "NAME"], []);
    expect(JSON.parse(result)).toEqual([]);
  });

  it("null stays null", () => {
    const result = toJson(["A"], [[null]]);
    const parsed = JSON.parse(result);
    expect(parsed[0].A).toBeNull();
  });

  it("undefined coerces to null", () => {
    const result = toJson(["A"], [[undefined]]);
    const parsed = JSON.parse(result);
    expect(parsed[0].A).toBeNull();
  });

  it("Date → ISO string", () => {
    const d = new Date("2024-06-01T00:00:00.000Z");
    const result = toJson(["DT"], [[d]]);
    const parsed = JSON.parse(result);
    expect(parsed[0].DT).toBe("2024-06-01T00:00:00.000Z");
  });

  it("number stays number", () => {
    const result = toJson(["NUM"], [[42]]);
    const parsed = JSON.parse(result);
    expect(parsed[0].NUM).toBe(42);
    expect(typeof parsed[0].NUM).toBe("number");
  });

  it("correct key names from columns", () => {
    const result = toJson(["FIRST_NAME", "LAST_NAME"], [["John", "Doe"]]);
    const parsed = JSON.parse(result);
    expect(parsed[0]).toEqual({ FIRST_NAME: "John", LAST_NAME: "Doe" });
  });

  it("multiple rows — all represented", () => {
    const result = toJson(["ID", "VAL"], [[1, "a"], [2, "b"]]);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toEqual({ ID: 2, VAL: "b" });
  });
});
