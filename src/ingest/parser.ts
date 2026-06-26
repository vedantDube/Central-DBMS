import { parse as csvParse } from "csv-parse/sync";
import unzipper from "unzipper";
import path from "node:path";

export type ParsedTable = {
  headers: string[];
  rows: string[][];
  jsonRows?: any[];
  sourceName?: string;
};

export async function parseBuffer(
  buffer: Buffer,
  filename: string,
): Promise<ParsedTable[]> {
  const text = buffer.toString("utf8").trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const json = JSON.parse(text);
      let jsonRows: any[] = [];
      if (Array.isArray(json)) {
        jsonRows = json;
      } else if (json.salesAndTrafficByDate || json.salesAndTrafficByAsin) {
        if (json.salesAndTrafficByDate) {
          jsonRows.push(
            ...json.salesAndTrafficByDate.map((item: any) => ({
              type: "date",
              ...item,
            })),
          );
        }
        if (json.salesAndTrafficByAsin) {
          jsonRows.push(
            ...json.salesAndTrafficByAsin.map((item: any) => ({
              type: "asin",
              ...item,
            })),
          );
        }
      } else {
        jsonRows = [json];
      }
      return [
        {
          headers: [],
          rows: [],
          jsonRows,
          sourceName: filename,
        },
      ];
    } catch (e) {
      // not valid JSON, fallback to CSV/TSV
    }
  }

  const ext = path.extname(filename).toLowerCase();
  if (ext === ".zip") {
    const result: ParsedTable[] = [];
    const directory = await unzipper.Open.buffer(buffer);
    for (const entry of directory.files) {
      const name = entry.path;
      const eext = path.extname(name).toLowerCase();
      if (eext === ".csv" || eext === ".tsv") {
        const content = await entry.buffer();
        const text = content.toString("utf8");
        const tryDelims = eext === ".tsv" ? ["\t"] : [",", "\t"];
        let records: any[] | null = null;
        let bestColCount = -1;
        let usedDelim = eext === ".tsv" ? "\t" : ",";
        for (const d of tryDelims) {
          try {
            const recs = csvParse(text, {
              columns: true,
              skip_empty_lines: true,
              delimiter: d,
              relax_quotes: true,
            });
            if (recs.length === 0) {
              if (bestColCount === -1) {
                records = recs;
                usedDelim = d;
              }
              continue;
            }
            const keys = Object.keys(recs[0] || {});
            const ok = recs.every(
              (r: any) => Object.keys(r).length === keys.length,
            );
            if (ok && keys.length > bestColCount) {
              bestColCount = keys.length;
              records = recs;
              usedDelim = d;
            }
          } catch (e) {
            // try next
          }
        }
        if (!records || (bestColCount === 1 && text.includes("\t"))) {
          // fallback: allow relaxed column counts with tab delimiter
          try {
            records = csvParse(text, {
              columns: true,
              skip_empty_lines: true,
              delimiter: "\t",
              relax_column_count: true,
              relax_quotes: true,
            });
            usedDelim = "\t";
          } catch (e) {
            throw e;
          }
        }
        const parsedRecords = records ?? [];
        let headers: string[] = [];
        if (parsedRecords.length > 0) {
          const firstLine = text.split(/\r?\n/)[0] || "";
          try {
            const headerRows = csvParse(firstLine, {
              columns: false,
              delimiter: usedDelim,
              relax_quotes: true,
            });
            if (headerRows && headerRows.length > 0) {
              headers = headerRows[0];
            }
          } catch (e) {
            headers = Object.keys(parsedRecords[0] ?? {});
          }
        }
        const rows = parsedRecords.map((r: any) =>
          headers.map((h) =>
            r[h] !== undefined && r[h] !== null ? String(r[h]) : "",
          ),
        );
        result.push({ headers, rows, sourceName: name });
      }
    }
    return result;
  }

  if (ext === ".csv" || ext === ".tsv" || ext === ".txt") {
    let text = buffer.toString("utf8");
    // Strip metadata preamble: if early lines are single-field quoted strings
    // (e.g. Amazon unified transaction reports), skip to the real header row
    const lines = text.split(/\r?\n/);
    let preambleEnd = 0;
    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const line = lines[i].trim();
      if (!line) { preambleEnd = i + 1; continue; }
      const commaCount = (line.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g) || []).length;
      const tabCount = (line.match(/\t/g) || []).length;
      if (commaCount >= 2 || tabCount >= 2) break;
      preambleEnd = i + 1;
    }
    if (preambleEnd > 0) {
      text = lines.slice(preambleEnd).join("\n");
    }
    const tryDelims = (ext === ".tsv" || ext === ".txt") ? ["\t"] : [",", "\t"];
    let records: any[] | null = null;
    let usedDelim = ",";
    let bestColCount = -1;
    for (const d of tryDelims) {
      try {
        const recs = csvParse(text, {
          columns: true,
          skip_empty_lines: true,
          delimiter: d,
          relax_quotes: true,
        });
        if (recs.length === 0) {
          if (bestColCount === -1) {
            records = recs;
            usedDelim = d;
          }
          continue;
        }
        const keys = Object.keys(recs[0] || {});
        const ok = recs.every(
          (r: any) => Object.keys(r).length === keys.length,
        );
        if (ok && keys.length > bestColCount) {
          bestColCount = keys.length;
          records = recs;
          usedDelim = d;
        }
      } catch (e) {
        // try next delimiter
      }
    }
    if (!records || (usedDelim === "," && bestColCount === 1 && text.includes("\t"))) {
      try {
        // fallback: try tab with relaxed column counts and relaxed quotes
        records = csvParse(text, {
          columns: true,
          skip_empty_lines: true,
          delimiter: "\t",
          relax_column_count: true,
          relax_quotes: true,
        });
        usedDelim = "\t";
      } catch (e) {
        // rethrow original parsing failure
        throw e;
      }
    }
    const parsedRecords = records ?? [];
    let headers: string[] = [];
    if (parsedRecords.length > 0) {
      const firstLine = text.split(/\r?\n/)[0] || "";
      try {
        const headerRows = csvParse(firstLine, {
          columns: false,
          delimiter: usedDelim,
          relax_quotes: true,
        });
        if (headerRows && headerRows.length > 0) {
          headers = headerRows[0];
        }
      } catch (e) {
        headers = Object.keys(parsedRecords[0] ?? {});
      }
    }
    const rows = parsedRecords.map((r: any) =>
      headers.map((h) =>
        r[h] !== undefined && r[h] !== null ? String(r[h]) : "",
      ),
    );
    return [{ headers, rows, sourceName: filename }];
  }

  throw new Error(`Unsupported file extension: ${ext}`);
}
