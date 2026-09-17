const { Pool } = require('pg');
const pool = new Pool({
  connectionString: "postgresql://postgres:123456@127.0.0.1:5432/primierdd?schema=public"
});

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT 
        c.id, c.name, c.tenant_id, c.owner_id,
        u.full_name as owner_name, u.email as owner_email, u.tenant_id as user_tenant_id,
        t.name as tenant_name, t.status as tenant_status, t.subscription_status, t.current_period_end,
        p.name as plan_name
      FROM companies c
      LEFT JOIN users u ON u.id = c.owner_id
      LEFT JOIN tenants t ON t.id = COALESCE(c.tenant_id, u.tenant_id)
      LEFT JOIN subscription_plans p ON p.id = t.plan_id
    `);
    console.log('--- COMPANY SUBSCRIPTIONS ---');
    console.log(JSON.stringify(res.rows, null, 2));
  } finally {
    client.release();
    pool.end();
  }
}

main().catch(console.error);
