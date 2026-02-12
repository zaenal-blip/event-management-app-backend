
import { PrismaClient } from "../../generated/prisma/client.js";
import { EventService } from "../modules/event/event.service.js";
import { TransactionService } from "../modules/transaction/transaction.service.js";

const prisma = new PrismaClient();
const eventService = new EventService(prisma);
const transactionService = new TransactionService(prisma);

async function main() {
    // Uncomment to reproduce error likely encountered
    // @ts-expect-error Expected 1 arguments, but got 0.
    // await eventService.getEvents(); 

    // @ts-expect-error Expected 1 arguments, but got 0.
    // await transactionService.getMyTransactions();

    console.log("To fix, pass the required arguments.");
}

main();
