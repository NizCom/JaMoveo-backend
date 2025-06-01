import res from "express/lib/response.js";
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool
  .connect()
  .then((client) => {
    console.log("Connected to PostgreSQL database");
    client.release();
  })
  .catch((err) => {
    console.error("Error connecting to PostgreSQL database", err.stack);
  });

async function insertNewMusician(newUser) {
  const { username, password, instrument, role } = newUser;
  const result = await pool.query(insertMusicianQuery, [
    username,
    password,
    instrument,
    role,
  ]);

  return result.rowCount;
}

async function findMusician(username) {
  const result = await pool.query(findUserQuery, [username]);

  return result.rowCount ? result.rows[0] : null;
}

const insertMusicianQuery = `
    INSERT INTO users (username, password, instrument, role)
    VALUES ($1, $2, $3, $4)
  `;

const findUserQuery = `
    SELECT *
    FROM users
    WHERE username = $1;
  `;

export { insertNewMusician, findMusician };
