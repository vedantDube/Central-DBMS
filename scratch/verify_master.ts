import { supabasePrisma } from "../src/prisma/client.js";
import { syncGstMaster } from "../src/ingest/sync-master.js";

async function main() {
  if (!supabasePrisma) {
    console.error("❌ SUPABASE_DB_URL is not configured.");
    return;
  }

  console.log("=== Starting Verification of Amazon GST Master Table ===");

  // 1. Run the sync process
  await syncGstMaster();

  try {
    // 2. Query Row Counts
    const b2bCount = await supabasePrisma.amazonGstMonthlyB2bRow.count();
    const b2cCount = await supabasePrisma.amazonGstMonthlyB2cRow.count();
    const masterCount = await supabasePrisma.amazonGstMasterRow.count();

    console.log("\n=== ROW COUNT CHECKS ===");
    console.log(`B2B Table Count: ${b2bCount}`);
    console.log(`B2C Table Count: ${b2cCount}`);
    console.log(`Master Table Count: ${masterCount}`);

    const totalExpected = b2bCount + b2cCount;
    if (masterCount === totalExpected) {
      console.log(`✅ Success: Master row count (${masterCount}) matches expected sum of B2B + B2C (${totalExpected}).`);
    } else {
      console.log(`❌ Error: Row count mismatch! Expected ${totalExpected}, got ${masterCount}`);
    }

    // 3. Math verification for B2B Sample
    if (b2bCount > 0) {
      console.log("\n=== VERIFYING B2B ROW DETAILS ===");
      const sampleB2B = await supabasePrisma.amazonGstMonthlyB2bRow.findFirst();
      if (sampleB2B && sampleB2B.order_id) {
        const mappedMaster = await supabasePrisma.amazonGstMasterRow.findFirst({
          where: { order_id: sampleB2B.order_id, flag: "B2B" }
        });

        if (mappedMaster) {
          console.log(`Checking Order ID: ${sampleB2B.order_id}`);
          
          const rawShippingTax = 
            parseFloat(sampleB2B.shipping_cgst_tax || "0") +
            parseFloat(sampleB2B.shipping_sgst_tax || "0") +
            parseFloat(sampleB2B.shipping_utgst_tax || "0") +
            parseFloat(sampleB2B.shipping_igst_tax || "0") +
            parseFloat(sampleB2B.shipping_cess_tax || "0");

          const rawGiftWrapTax = 
            parseFloat(sampleB2B.gift_wrap_cgst_tax || "0") +
            parseFloat(sampleB2B.gift_wrap_sgst_tax || "0") +
            parseFloat(sampleB2B.gift_wrap_utgst_tax || "0") +
            parseFloat(sampleB2B.gift_wrap_igst_tax || "0") +
            parseFloat(sampleB2B.gift_wrap_compensatory_cess_tax || "0");

          const rawTcsGst = 
            parseFloat(sampleB2B.tcs_cgst_amount || "0") +
            parseFloat(sampleB2B.tcs_sgst_amount || "0") +
            parseFloat(sampleB2B.tcs_utgst_amount || "0") +
            parseFloat(sampleB2B.tcs_igst_amount || "0");

          console.log(`- Shipping Tax (Source Sum): ${rawShippingTax} | Master: ${mappedMaster.shipping_tax}`);
          console.log(`- Gift Wrap Tax (Source Sum): ${rawGiftWrapTax} | Master: ${mappedMaster.gift_wrap_tax}`);
          console.log(`- Gift Wrap Basis (Source diff): ${parseFloat(sampleB2B.gift_wrap_amount || "0") - rawGiftWrapTax} | Master: ${mappedMaster.gift_wrap_basis}`);
          console.log(`- TCS GST (Source Sum): ${rawTcsGst} | Master: ${mappedMaster.tcs_gst}`);

          const diffs = 
            Math.abs((mappedMaster.shipping_tax || 0) - rawShippingTax) +
            Math.abs((mappedMaster.gift_wrap_tax || 0) - rawGiftWrapTax) +
            Math.abs((mappedMaster.tcs_gst || 0) - rawTcsGst);

          if (diffs < 0.001) {
            console.log("✅ Success: Mapped B2B math checks out correctly.");
          } else {
            console.log("❌ Error: B2B math mismatch detected!");
          }
        }
      }
    }

    // 4. Math verification for B2C Sample
    if (b2cCount > 0) {
      console.log("\n=== VERIFYING B2C ROW DETAILS ===");
      const sampleB2C = await supabasePrisma.amazonGstMonthlyB2cRow.findFirst();
      if (sampleB2C && sampleB2C.order_id) {
        const mappedMaster = await supabasePrisma.amazonGstMasterRow.findFirst({
          where: { order_id: sampleB2C.order_id, flag: "B2C" }
        });

        if (mappedMaster) {
          console.log(`Checking Order ID: ${sampleB2C.order_id}`);
          
          const rawShippingTax = 
            parseFloat(sampleB2C.shipping_cgst_tax || "0") +
            parseFloat(sampleB2C.shipping_sgst_tax || "0") +
            parseFloat(sampleB2C.shipping_utgst_tax || "0") +
            parseFloat(sampleB2C.shipping_igst_tax || "0") +
            parseFloat(sampleB2C.shipping_cess_tax_amount || "0");

          const rawGiftWrapTax = 
            parseFloat(sampleB2C.gift_wrap_cgst_tax || "0") +
            parseFloat(sampleB2C.gift_wrap_sgst_tax || "0") +
            parseFloat(sampleB2C.gift_wrap_utgst_tax || "0") +
            parseFloat(sampleB2C.gift_wrap_igst_tax || "0") +
            parseFloat(sampleB2C.gift_wrap_compensatory_cess_tax || "0");

          const rawTcsGst = 
            parseFloat(sampleB2C.tcs_cgst_amount || "0") +
            parseFloat(sampleB2C.tcs_sgst_amount || "0") +
            parseFloat(sampleB2C.tcs_utgst_amount || "0") +
            parseFloat(sampleB2C.tcs_igst_amount || "0");

          console.log(`- Shipping Tax (Source Sum): ${rawShippingTax} | Master: ${mappedMaster.shipping_tax}`);
          console.log(`- Gift Wrap Tax (Source Sum): ${rawGiftWrapTax} | Master: ${mappedMaster.gift_wrap_tax}`);
          console.log(`- Gift Wrap Basis (Source diff): ${parseFloat(sampleB2C.gift_wrap_amount || "0") - rawGiftWrapTax} | Master: ${mappedMaster.gift_wrap_basis}`);
          console.log(`- TCS GST (Source Sum): ${rawTcsGst} | Master: ${mappedMaster.tcs_gst}`);

          const diffs = 
            Math.abs((mappedMaster.shipping_tax || 0) - rawShippingTax) +
            Math.abs((mappedMaster.gift_wrap_tax || 0) - rawGiftWrapTax) +
            Math.abs((mappedMaster.tcs_gst || 0) - rawTcsGst);

          if (diffs < 0.001) {
            console.log("✅ Success: Mapped B2C math checks out correctly.");
          } else {
            console.log("❌ Error: B2C math mismatch detected!");
          }
        }
      }
    }

  } catch (err) {
    console.error("❌ Error during verification:", err);
  } finally {
    await supabasePrisma.$disconnect();
  }
}

main();
