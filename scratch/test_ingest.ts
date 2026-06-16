import fs from 'node:fs';
import path from 'node:path';
import unzipper from 'unzipper';
import { ingestDownloadedReports } from '../src/ingest/ingest-downloaded-reports.ts';

const samples = [
  {
    zip: 'b2bReport_May_2026.zip',
    destDir: 'downloads/amazon/tax/monthly-b2b'
  },
  {
    zip: 'b2cReport_May_2026.zip',
    destDir: 'downloads/amazon/tax/monthly-b2c'
  },
  {
    zip: 'stockTransferReport_May_2026.zip',
    destDir: 'downloads/amazon/tax/monthly-str'
  }
];

async function extractSample(sample) {
  const zipPath = path.join(process.cwd(), 'scratch', sample.zip);
  const targetDir = path.join(process.cwd(), sample.destDir);
  
  await fs.promises.mkdir(targetDir, { recursive: true });
  console.log(`Extracting ${sample.zip} to ${sample.destDir}...`);
  
  const directory = await unzipper.Open.file(zipPath);
  for (const entry of directory.files) {
    if (entry.path.endsWith('.csv')) {
      const targetPath = path.join(targetDir, path.basename(entry.path));
      const buffer = await entry.buffer();
      await fs.promises.writeFile(targetPath, buffer);
      console.log(`Extracted CSV to: ${targetPath}`);
    }
  }
}

async function main() {
  for (const sample of samples) {
    await extractSample(sample);
  }
  
  console.log('\nRunning ingestDownloadedReports()...');
  await ingestDownloadedReports();
  console.log('\nIngestion completed successfully!');
}

main().catch(err => {
  console.error('Test ingestion failed:', err);
});
