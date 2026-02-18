const express = require('express');
const router = express.Router();

// POST /logs/client
// Lightweight ingestion endpoint for extension-side diagnostics.
router.post('/client', (req, res) => {
  const {
    level = 'info',
    message = '',
    provider,
    phase,
    userId,
    context
  } = req.body || {};

  const payload = {
    source: 'extension',
    provider: provider || null,
    phase: phase || null,
    userId: userId || null,
    message: String(message || ''),
    context: context || null
  };

  if (String(level).toLowerCase() === 'error') {
    console.error('[client-log]', payload);
  } else {
    console.log('[client-log]', payload);
  }

  return res.json({ ok: true });
});

module.exports = router;
