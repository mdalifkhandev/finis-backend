const { PrismaClient } = require('./src/generated/prisma');
const prisma = new PrismaClient();

async function cleanDatabase() {
  try {
    console.log('Starting database cleanup...');
    
    // 1. Set all users' tenantId to null so they don't reference deleted tenants
    console.log('Unlinking users from tenants...');
    await prisma.$executeRawUnsafe(`UPDATE "users" SET "tenant_id" = NULL;`);
    
    // 2. Disable foreign key checks for the session
    await prisma.$executeRawUnsafe(`SET session_replication_role = 'replica';`);
    
    // 3. Get all tables
    const tables = await prisma.$queryRaw`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public';
    `;
    
    // 4. Delete all rows from each table except users and prisma migrations
    for (const { tablename } of tables) {
      if (tablename !== 'users' && tablename !== '_prisma_migrations') {
        console.log(`Clearing table: ${tablename}`);
        await prisma.$executeRawUnsafe(`DELETE FROM "${tablename}";`);
      }
    }
    
    // 5. Re-enable foreign key checks
    await prisma.$executeRawUnsafe(`SET session_replication_role = 'origin';`);
    
    console.log('✅ Database cleaned successfully! (Users are preserved)');
  } catch (error) {
    console.error('Error cleaning database:', error);
    // Try to re-enable triggers in case of error
    await prisma.$executeRawUnsafe(`SET session_replication_role = 'origin';`).catch(() => {});
  } finally {
    await prisma.$disconnect();
  }
}

cleanDatabase();
