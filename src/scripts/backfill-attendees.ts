import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg({ connectionString }, { schema: "public" });
const prisma = new PrismaClient({ adapter });

async function main() {
  const txns = await prisma.transaction.findMany({
    where: { status: "DONE", attendees: { none: {} } },
    select: {
      id: true,
      userId: true,
      eventId: true,
      ticketTypeId: true,
      user: { select: { name: true } },
      event: { select: { title: true } },
    },
  });

  console.log(`Found ${txns.length} DONE transactions without attendees`);

  for (const txn of txns) {
    try {
      await prisma.attendee.create({
        data: {
          transactionId: txn.id,
          userId: txn.userId,
          eventId: txn.eventId,
          ticketTypeId: txn.ticketTypeId,
        },
      });
      console.log(
        `  ✅ Created attendee: ${txn.user.name} → ${txn.event.title} (txn #${txn.id})`,
      );
    } catch (e: any) {
      if (e.code === "P2002") {
        console.log(`  ⏭️ Skipped (already exists): txn #${txn.id}`);
      } else {
        console.error(`  ❌ Error txn #${txn.id}:`, e.message);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
