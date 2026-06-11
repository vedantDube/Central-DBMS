import crypto from 'node:crypto';
import { prisma } from '../prisma/client.js';

export type ReportArtifactInput = {
  reportKey: string;
  reportLabel: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  source: string;
  rawContent: string;
};

export async function saveReportArtifact(input: ReportArtifactInput): Promise<void> {
  await prisma.reportArtifact.create({
    data: {
      reportKey: input.reportKey,
      reportLabel: input.reportLabel,
      storagePath: input.storagePath,
      fileName: input.fileName,
      contentType: input.contentType,
      source: input.source,
      rawContent: input.rawContent,
      sha256: crypto.createHash('sha256').update(input.rawContent, 'utf8').digest('hex')
    }
  });
}