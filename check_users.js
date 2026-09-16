const { Pool } = require('pg');

const pool = new Pool({
  connectionString: "postgresql://postgres:123456@127.0.0.1:5432/primierdd?schema=public"
});

async function main() {
  const client = await pool.connect();
  try {
    const expenses = await client.query(`
      SELECT r.id, r.title, r.status, r.created_by_id, u.email, u.role, u.full_name
      FROM reimbursement_expenses r
      JOIN users u ON r.created_by_id = u.id
    `);
    console.log('Expenses created by:', expenses.rows);

    const allUsers = await client.query(`
      SELECT id, email, role, full_name FROM users
    `);
    console.log('Users in DB:', allUsers.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
