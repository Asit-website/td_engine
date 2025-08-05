const axios = require('axios');

module.exports = (router) => {
  // GET /bot/lookup/:dnis
  // td_engine/lib/routes/bot.js
  router.get('/api/admin/bots/lookup/:dnis', async (req, res) => {
    try {
      const { dnis } = req.params;
      // Forward the request to the backend (or middle layer)
      const response = await axios.get(`http://localhost:5000/api/admin/bots/lookup/${encodeURIComponent(dnis)}`);
      res.json(response.data);
    } catch (err) {
      res.status(500).json({ error: 'Failed to lookup bot by DNIS', details: err.message });
    }
  });
}; 