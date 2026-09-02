const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  console.log('🌱 Seeding users into PostgreSQL...');

  const passwordHash = await bcrypt.hash('123456', 10);

  const users = [
    {
      email: 'superadmin@gmail.com',
      fullName: 'Super Admin',
      role: 'super_admin',
      status: 'active',
      phone: '+10000000001',
    },
    {
      email: 'superadmin@finis.com',
      fullName: 'Super Admin (Official)',
      role: 'super_admin',
      status: 'active',
      phone: '+10000000000',
    },
    {
      email: 'admin1@gmail.com',
      fullName: 'Admin One',
      role: 'admin',
      status: 'active',
      phone: '+10000000002',
    },
    {
      email: 'manager1@gmail.com',
      fullName: 'Manager One',
      role: 'manager',
      status: 'active',
      phone: '+10000000003',
    },
    {
      email: 'worker1@gmail.com',
      fullName: 'Worker One',
      role: 'worker',
      status: 'active',
      phone: '+10000000004',
    },
  ];

  for (const user of users) {
    const res = await pool.query('SELECT id FROM users WHERE email = $1', [user.email]);
    if (res.rows.length === 0) {
      await pool.query(
        `INSERT INTO users (id, email, full_name, password_hash, role, status, phone, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [user.email, user.fullName, passwordHash, user.role, user.status, user.phone]
      );
      console.log(`✅ Created ${user.role}: ${user.email}`);
    } else {
      await pool.query(
        `UPDATE users SET password_hash = $1, role = $2, status = $3, full_name = $4 WHERE email = $5`,
        [passwordHash, user.role, user.status, user.fullName, user.email]
      );
      console.log(`🔄 Updated ${user.role}: ${user.email}`);
    }
  }

  console.log('🎉 All user accounts seeded successfully!');
}

seed()
  .catch((err) => {
    console.error('❌ Seed error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
