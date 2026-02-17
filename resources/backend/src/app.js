const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const connectRoutes = require('./routes/connect');
const proxyRoutes = require('./routes/proxy');
const statusRoutes = require('./routes/status');

const app = express();

app.use(cors());
// Keep Stripe webhook body raw for signature verification.
app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/billing/webhook')) return next();
    return bodyParser.json()(req, res, next);
});
app.use(bodyParser.urlencoded({ extended: true }));

// Tech: HTML forms for connect
app.use(express.static('public')); // If we had public assets

// Routes
// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date(), version: process.env.npm_package_version });
});

app.use('/connect', connectRoutes);
app.use('/proxy', proxyRoutes);
app.use('/connections', statusRoutes);
app.use('/connections', statusRoutes);
app.use('/teams', require('./routes/teams'));
app.use('/auth', require('./routes/auth'));

// Success Page
// Success Page
app.get('/auth/success', (req, res) => {

    // Security Check: Must come from Stripe or Vault
    const { session_id, source, id, sig } = req.query;
    let isValid = false;

    // 1. Stripe Check
    if (session_id) {
        // In a stricter world, we'd retrieve the session from Stripe API here
        // to confirm it's real and paid. For now, existence of ID is the "unique id" check requested.
        isValid = true;
    }
    // 2. Vault Check
    else if (source === 'vault' && id && sig) {
        const crypto = require('crypto');
        const hmac = crypto.createHmac('sha256', process.env.ENCRYPTION_KEY);
        hmac.update(`vault-${id}`);
        const expectedSig = hmac.digest('hex');
        if (sig === expectedSig) {
            isValid = true;
        }
    }

    if (!isValid) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Page Not Found | Flocca</title>
                <style>
                    body { font-family: -apple-system, system-ui, sans-serif; background: #0f172a; color: #fff; height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; text-align: center; }
                    .container { max-width: 400px; padding: 20px; }
                    h1 { color: #f472b6; font-size: 48px; margin-bottom: 10px; }
                    p { color: #94a3b8; font-size: 16px; line-height: 1.6; }
                    a { color: #6c5ce7; text-decoration: none; font-weight: bold; }
                    .logo { font-size: 24px; font-weight: bold; margin-bottom: 40px; display: block; opacity: 0.5; }
                </style>
            </head>
            <body>
                <div class="container">
                    <span class="logo">flocca</span>
                    <h1>404</h1>
                    <p>The page you are looking for does not exist or you do not have permission to view it.</p>
                    <p>Return to <a href="https://flocca.app">Flocca Homepage</a></p>
                </div>
            </body>
            </html>
        `);
    }

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Connection Successful | Flocca</title>
            <style>
                :root {
                    --bg: #0f172a;
                    --card-bg: #1e293b;
                    --text-main: #f8fafc;
                    --text-sub: #94a3b8;
                    --accent: #6c5ce7;
                    --accent-glow: rgba(108, 92, 231, 0.4);
                    --success: #10b981;
                }
                body {
                    margin: 0;
                    height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    background-color: var(--bg);
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                    color: var(--text-main);
                    overflow: hidden;
                }
                .container {
                    background: var(--card-bg);
                    padding: 40px;
                    border-radius: 24px;
                    text-align: center;
                    width: 360px;
                    box-shadow: 0 20px 50px -10px rgba(0,0,0,0.5);
                    position: relative;
                    animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
                    border: 1px solid rgba(255,255,255,0.05);
                }
                
                /* Success Icon Animation */
                .icon-circle {
                    width: 80px;
                    height: 80px;
                    border-radius: 50%;
                    background: rgba(16, 185, 129, 0.1);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 24px auto;
                    color: var(--success);
                    font-size: 32px;
                    animation: scaleIn 0.4s 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) both;
                }
                
                h1 {
                    font-size: 24px;
                    margin: 0 0 12px 0;
                    font-weight: 700;
                    letter-spacing: -0.5px;
                }
                
                p {
                    color: var(--text-sub);
                    font-size: 15px;
                    margin: 0 0 32px 0;
                    line-height: 1.5;
                }

                .btn {
                    background: linear-gradient(135deg, var(--accent), #a29bfe);
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 12px;
                    font-size: 15px;
                    font-weight: 600;
                    cursor: pointer;
                    width: 100%;
                    transition: transform 0.2s, opacity 0.2s;
                    box-shadow: 0 4px 15px var(--accent-glow);
                }
                .btn:hover {
                    transform: translateY(-2px);
                    opacity: 0.9;
                }
                .btn:active {
                    transform: translateY(0);
                }

                /* Background Gradient Blobs */
                .blob {
                    position: absolute;
                    width: 300px;
                    height: 300px;
                    background: var(--accent);
                    filter: blur(80px);
                    opacity: 0.15;
                    border-radius: 50%;
                    z-index: -1;
                }
                .blob-1 { top: -100px; left: -100px; }
                .blob-2 { bottom: -100px; right: -100px; background: #00cec9; }

                @keyframes slideUp {
                    from { transform: translateY(40px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                @keyframes scaleIn {
                    from { transform: scale(0); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
            </style>
        </head>
        <body>
            <div class="blob blob-1"></div>
            <div class="blob blob-2"></div>
            
            <div class="container">
                <div class="icon-circle">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </div>
                <h1>Success!</h1>
                <p>Your account has been securely connected to the Flocca Vault.</p>
                <button class="btn" onclick="closeMe()">Close Window</button>
            </div>
            
            <script>
                function closeMe() {
                    // Attempt to close the window
                    window.opener = null;
                    window.open('', '_self');
                    window.close();
                    
                    // Fallback visual feedback if it fails
                    setTimeout(() => {
                        document.querySelector('p').innerText = "Browser security may prevent auto-closing. Please close this tab manually.";
                    }, 500);
                }
            </script>
        </body>
        </html>
    `);
});

app.get('/subscription/status', async (req, res) => {
    // Redirect legacy call to new billing status
    const billingRouter = require('./routes/billing');
    // We can't easily jump into router logic here without mocking req/res, 
    // but better to just mount billing routes at /billing and update client, 
    // OR just use the handler logic if exported.
    // Simpler: Client (Extension) calls /subscription/status. 
    // We should implement that endpoint properly using DB now.

    // Actually, let's just use the logic from billing.js via a redirect or direct DB call here?
    // No, better to mount /billing and redirect /subscription/status to it?
    // Or just implement it here to keep clean.

    const userId = req.query.userId || req.headers['x-flocca-user-id'];
    if (!userId) return res.json({ plan: 'free' });

    const { PrismaClient } = require('@prisma/client'); // Or get singleton
    const prisma = require('./db');

    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const plan = user?.subscriptionStatus || 'free';

        // Define Feature Matrix
        const FEATURES = {
            free: {
                pro_integrations: false,
                unlimited_vault: false,
                mcp_workflows: false,
                priority_support: false,
                shared_vault: false,
                shared_workflows: false,
                seat_billing: false
            },
            individual: {
                pro_integrations: true,
                unlimited_vault: true,
                mcp_workflows: true,
                priority_support: true,
                shared_vault: false,
                shared_workflows: false,
                seat_billing: false
            },
            teams: {
                pro_integrations: true,
                unlimited_vault: true,
                mcp_workflows: true,
                priority_support: true,
                shared_vault: true,
                shared_workflows: true,
                seat_billing: true
            },
            enterprise: {
                pro_integrations: true,
                unlimited_vault: true,
                mcp_workflows: true,
                priority_support: true,
                shared_vault: true,
                shared_workflows: true,
                seat_billing: true
            }
        };

        const permissions = FEATURES[plan] || FEATURES.free;

        res.json({
            status: (plan === 'individual' || plan === 'teams' || plan === 'enterprise') ? 'active' : 'inactive', // For legacy extension check
            plan: plan,
            features: permissions
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

const billingRoutes = require('./routes/billing');
app.use('/billing', billingRoutes);



// Webhook


module.exports = app;
