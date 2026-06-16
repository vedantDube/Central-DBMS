import { supabasePrisma } from "../src/prisma/client.js";

async function main() {
  if (!supabasePrisma) {
    console.log("Supabase prisma client is not defined");
    return;
  }
  const keys = Object.keys(supabasePrisma).filter(k => !k.startsWith("_") && !k.startsWith("$"));
  console.log("Supabase Prisma Client Keys:", keys);
}

main();
