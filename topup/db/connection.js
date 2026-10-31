// db/connection.js — reuse the same sqlite connection everywhere
const db = require('./init'); // running init.js also ensures schema/seed exist
module.exports = db;
