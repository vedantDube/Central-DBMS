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
            }
          } catch (e) {
            // try next
          }
        }
        if (!records) {
          // fallback: allow relaxed column counts with tab delimiter
          try {
            records = csvParse(text, {
              columns: true,
              skip_empty_lines: true,
              delimiter: "\t",
              relax_column_count: true,
              relax_quotes: true,
            });
          } catch (e) {
            throw e;
          }
        }
        const parsedRecords = records ?? [];
        const firstRecord = parsedRecords[0] ?? {};
        const headers = Object.keys(firstRecord);
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

  if (ext === ".csv" || ext === ".tsv") {
    const text = buffer.toString("utf8");
    const tryDelims = ext === ".tsv" ? ["\t"] : [",", "\t"];
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
    if (!records) {
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
    const firstRecord = parsedRecords[0] ?? {};
    const headers = Object.keys(firstRecord);
    const rows = parsedRecords.map((r: any) =>
      headers.map((h) =>
        r[h] !== undefined && r[h] !== null ? String(r[h]) : "",
      ),
    );
    return [{ headers, rows, sourceName: filename }];
  }

  throw new Error(`Unsupported file extension: ${ext}`);
}
