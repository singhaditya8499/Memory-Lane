const express = require('express');
const path = require('path');
require('dotenv').config();

require('./db/firestore');

const journeyRoutes = require('./routes/journeys');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));
app.use('/api/journeys', journeyRoutes);
app.use('/', express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`MemoryLane app running at http://localhost:${port}`);
});
