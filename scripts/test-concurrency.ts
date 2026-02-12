
import * as fs from 'fs';
import { prisma } from "../src/lib/prisma.js";
import { TransactionService } from "../src/modules/transaction/transaction.service.js";
const transactionService = new TransactionService(prisma);

async function main() {
    try {
        console.log("Starting Concurrency Test...");

        // 1. Setup
        const setupRun = await prisma.$transaction(async (tx) => {
            let user = await tx.user.findFirst({ where: { email: "test_concurrency@example.com" } });
            if (!user) {
                user = await tx.user.create({
                    data: {
                        name: "Test Concurrency",
                        email: "test_concurrency@example.com",
                        password: "hashed_password",
                        role: "ORGANIZER",
                    }
                });
            }

            let organizer = await tx.organizer.findUnique({ where: { userId: user.id } });
            if (!organizer) {
                organizer = await tx.organizer.create({
                    data: { userId: user.id, name: "Test Org" }
                });
            }

            // Create a unique title to avoid unique constraint violations if cleanup failed
            const uniqueTitle = `Concurrency Test Event ${Date.now()}`;

            const event = await tx.event.create({
                data: {
                    organizerId: organizer.id,
                    title: uniqueTitle,
                    description: "Testing row locking",
                    category: "Test",
                    location: "Test Loc",
                    venue: "Test Venue",
                    startDate: new Date(),
                    endDate: new Date(Date.now() + 86400000),
                    status: "PUBLISHED",
                    ticketTypes: {
                        create: {
                            name: "Limited Seat",
                            description: "Only 5 seats",
                            price: 10000,
                            totalSeat: 5,
                            availableSeat: 5,
                        }
                    }
                },
                include: { ticketTypes: true }
            });

            return { user, organizer, event };
        });

        const { user, event } = setupRun;
        const ticketTypeId = event.ticketTypes[0].id;

        console.log(`Created Event ${event.id} with TicketType ${ticketTypeId} having 5 seats.`);

        // 2. Simulate 10 concurrent requests
        const totalRequests = 10;
        console.log(`Launching ${totalRequests} concurrent purchase requests...`);

        type Result = { status: 'fulfilled', value: any } | { status: 'rejected', reason: any };
        const promises: Promise<Result>[] = [];
        for (let i = 0; i < totalRequests; i++) {
            promises.push(
                transactionService.createTransaction(user.id, event.id, {
                    ticketTypeId,
                    quantity: 1,
                    pointsToUse: 0
                }).then(res => ({ status: 'fulfilled', value: res } as Result))
                    .catch(err => ({ status: 'rejected', reason: err } as Result))
            );
        }

        const results = await Promise.all(promises);

        // 3. Analyze Results
        let successCount = 0;
        let failureCount = 0;

        for (const res of results) {
            if (res.status === 'fulfilled') {
                successCount++;
            } else {
                const errorMsg = res.reason instanceof Error ? res.reason.message : String(res.reason);
                if (errorMsg === "Not enough seats available" || errorMsg.includes("Not enough seats")) {
                    failureCount++;
                } else {
                    console.error("Unexpected error in request:", res.reason);
                    failureCount++;
                }
            }
        }

        console.log(`Results: ${successCount} Success, ${failureCount} Failures`);

        // 4. Verify Database State
        const finalTicketType = await prisma.ticketType.findUnique({
            where: { id: ticketTypeId }
        });

        console.log(`Final Available Seats: ${finalTicketType?.availableSeat}`);
        console.log(`Final Sold: ${finalTicketType?.sold}`);

        // Cleanup (Optional)
        // await prisma.event.delete({ where: { id: event.id } });

        if (successCount === 5 && finalTicketType?.availableSeat === 0) {
            console.log("TEST PASSED: No overselling occurred.");
            process.exit(0);
        } else {
            console.error("TEST FAILED: Overselling or Underselling occurred.");
            process.exit(1);
        }

    } catch (error) {
        console.error("FATAL ERROR IN SCRIPT:");
        console.dir(error, { depth: null });

        try {
            fs.writeFileSync('error.log', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
            if (error instanceof Error) {
                fs.appendFileSync('error.log', '\nSTACK:\n' + error.stack);
            }
        } catch (filesysError) {
            console.error("Could not write error log:", filesysError);
        }

        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
