# CDBMS Amazon ingestion

This project downloads Amazon reports as CSV or TSV, stores them locally, and writes each raw file into Supabase Postgres through Prisma.

## What it supports

- Amazon MTR reports
- Returns reports for B2C and B2B
- Payment transaction reports
- Claims and reimbursements reports
- Day-level inventory reports
- Ads and campaign reports
- LIS data
- Payment statement reports

## Setup

1. Copy `.env.example` to `.env` and fill in the values.
2. Install dependencies with `npm install`.
3. Run all configured reports with `npm run ingest`.

## Notes

- API downloads use Amazon SP-API when a report type id is configured.
- Browser automation is available as a fallback for reports that need manual Seller Central navigation.
- Files are stored in the `ReportArtifact` table through Prisma.
