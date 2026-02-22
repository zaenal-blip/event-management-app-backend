import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg({ connectionString }, { schema: "public" });
const prisma = new PrismaClient({
    adapter,
    transactionOptions: {
        maxWait: 10000,
        timeout: 15000,
    },
});

export { prisma };
