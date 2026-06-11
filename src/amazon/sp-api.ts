import crypto from "node:crypto";
import { env } from "../config.js";
import type { DownloadResult } from "../types.js";

const endpoints: Record<"eu" | "na" | "fe", string> = {
  eu: "https://sellingpartnerapi-eu.amazon.com",
  na: "https://sellingpartnerapi-na.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};

function toIsoDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function sha256Hex(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(
  key: Buffer | string,
  data: string,
  encoding?: crypto.BinaryToTextEncoding,
): Buffer | string {
  if (encoding) {
    return crypto.createHmac("sha256", key).update(data).digest(encoding);
  }

  return crypto.createHmac("sha256", key).update(data).digest();
}

function signRequest(input: {
  method: string;
  host: string;
  path: string;
  query: string;
  body: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  accessToken: string;
  contentType?: string;
  timestamp: Date;
}): { authorization: string; amzDate: string; payloadHash: string } {
  const amzDate = toIsoDate(input.timestamp);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(input.body);
  const canonicalHeaders =
    [
      input.contentType ? `content-type:${input.contentType}` : undefined,
      `host:${input.host}`,
      `x-amz-access-token:${input.accessToken}`,
      `x-amz-content-sha256:${payloadHash}`,
      `x-amz-date:${amzDate}`,
    ]
      .filter(Boolean)
      .join("\n") + "\n";
  const signedHeaders = input.contentType
    ? "content-type;host;x-amz-access-token;x-amz-content-sha256;x-amz-date"
    : "host;x-amz-access-token;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    input.method,
    input.path,
    input.query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp) as Buffer;
  const kRegion = hmac(kDate, input.region) as Buffer;
  const kService = hmac(kRegion, input.service) as Buffer;
  const kSigning = hmac(kService, "aws4_request") as Buffer;
  const signature = hmac(kSigning, stringToSign, "hex") as string;

  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
    payloadHash,
  };
}

async function getLwaAccessToken(): Promise<string> {
  if (!env.SP_REFRESH_TOKEN || !env.SP_CLIENT_ID || !env.SP_CLIENT_SECRET) {
    throw new Error("Missing SP-API OAuth credentials in environment");
  }

  const response = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env.SP_REFRESH_TOKEN,
      client_id: env.SP_CLIENT_ID,
      client_secret: env.SP_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to refresh LWA access token: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("Amazon token response did not include an access_token");
  }

  return payload.access_token;
}

async function spApiRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new Error("Missing AWS credentials in environment");
  }

  const host = new URL(endpoints[env.REGION]).host;
  const bodyText = body ? JSON.stringify(body) : "";
  const token = await getLwaAccessToken();
  const timestamp = new Date();
  const { authorization, amzDate, payloadHash } = signRequest({
    method,
    host,
    path,
    query: "",
    body: bodyText,
    region: env.REGION,
    service: "execute-api",
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    accessToken: token,
    contentType: bodyText ? "application/json; charset=utf-8" : undefined,
    timestamp,
  });

  const response = await fetch(`${endpoints[env.REGION]}${path}`, {
    method,
    headers: {
      "x-amz-access-token": token,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      ...(bodyText
        ? { "content-type": "application/json; charset=utf-8" }
        : {}),
      authorization,
    },
    body: bodyText || undefined,
  });

  if (!response.ok) {
    throw new Error(
      `SP-API request failed for ${path}: ${response.status} ${response.statusText} - ${await response.text()}`,
    );
  }

  return response.json() as Promise<T>;
}

async function downloadDocument(
  documentId: string,
  fileExtension: "csv" | "tsv",
): Promise<DownloadResult> {
  const document = await spApiRequest<{
    url: string;
    compressionAlgorithm?: "GZIP";
  }>("GET", `/reports/2021-06-30/documents/${documentId}`);

  const response = await fetch(document.url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch report document: ${response.status} ${response.statusText}`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const body =
    document.compressionAlgorithm === "GZIP"
      ? await import("node:zlib").then((zlib) => zlib.gunzipSync(bytes))
      : bytes;

  return {
    fileName: `${documentId}.${fileExtension}`,
    contentType:
      fileExtension === "tsv" ? "text/tab-separated-values" : "text/csv",
    body,
    source: "sp-api",
  };
}

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

export async function downloadSpApiReport(
  reportTypeId: string,
  fileExtension: "csv" | "tsv",
): Promise<DownloadResult> {
  const daysStr = getArgValue("--days");
  const days = daysStr ? parseInt(daysStr, 10) : 75;

  const createResponse = await spApiRequest<{ reportId: string }>(
    "POST",
    "/reports/2021-06-30/reports",
    {
      reportType: reportTypeId,
      marketplaceIds: [env.MARKETPLACE_ID],
      dataStartTime: new Date(
        Date.now() - 1000 * 60 * 60 * 24 * days,
      ).toISOString(),
    },
  );

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const report = await spApiRequest<{
      processingStatus: string;
      reportDocumentId?: string;
    }>("GET", `/reports/2021-06-30/reports/${createResponse.reportId}`);

    if (report.processingStatus === "DONE" && report.reportDocumentId) {
      return downloadDocument(report.reportDocumentId, fileExtension);
    }

    if (
      report.processingStatus === "CANCELLED" ||
      report.processingStatus === "FATAL"
    ) {
      throw new Error(
        `Amazon report failed with status ${report.processingStatus}`,
      );
    }
  }

  throw new Error(`Timed out waiting for SP-API report ${reportTypeId}`);
}
