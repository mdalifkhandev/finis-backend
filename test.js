const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  console.log('Time Adjustments:', await prisma.timeAdjustmentRequest.findMany());
  console.log('WorkerManagerMap:', await prisma.workerManagerMap.findMany());
}
main().finally(() => prisma.$disconnect());
