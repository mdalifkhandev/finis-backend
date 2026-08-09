const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:123456@localhost:5432/primierdd?schema=public'
});
client.connect().then(() => {
  return client.query(`SELECT "MessageThread".id, "MessageThread".name, "MessageThread".type, "ThreadParticipant"."userId", "ThreadParticipant"."role" FROM "MessageThread" LEFT JOIN "ThreadParticipant" ON "MessageThread".id = "ThreadParticipant"."threadId" WHERE "MessageThread".name = 'Project2'`);
}).then(res => {
  console.log(res.rows);
  client.end();
}).catch(console.error);
