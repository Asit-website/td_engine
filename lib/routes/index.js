const express = require('express');

module.exports = ({ logger, makeService }) => {
  const router = express.Router();

  // Setup WebSocket routes
  require('./llm-streaming')({ logger, makeService });
  // Note: chat-streaming is handled directly in app.js to avoid duplicate initialization

  // Attach normal REST routes to router
  require('./bot')(router);
  require('./report')(router);

  return router;
};
