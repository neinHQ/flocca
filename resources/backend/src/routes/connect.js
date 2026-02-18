const express = require('express');
const router = express.Router();
const { encrypt } = require('../../utils/crypto');
const prisma = require('../db');

// Form Fields Config (Reused from previous server.js)
const PROVIDER_FIELDS = {
    'zephyr': [
        { id: 'site', label: 'Jira/Zephyr Site URL', value: 'https://my-org.atlassian.net' },
        { id: 'token', label: 'API Token', value: '', type: 'password' },
        { id: 'projectKey', label: 'Project Key', value: '' }
    ],
    'figma': [
        { id: 'token', label: 'Personal Access Token', value: '', type: 'password' }
    ],
    'jira': [
        { id: 'email', label: 'Email', value: '' },
        { id: 'token', label: 'API Token', value: '', type: 'password' },
        { id: 'site', label: 'Jira Base URL', value: 'https://my-org.atlassian.net' }
    ],
    'slack': [
        { id: 'token', label: 'Bot Token (xoxb-)', value: '', type: 'password' }
    ],
    'gitlab': [
        { id: 'token', label: 'Personal Access Token', value: '', type: 'password' },
        { id: 'site', label: 'GitLab Base URL', value: 'https://gitlab.com/api/v4' }
    ],
    'bitbucket': [
        { id: 'username', label: 'Username', value: '' },
        { id: 'password', label: 'App Password', value: '', type: 'password' },
        { id: 'site', label: 'Service URL', value: 'https://api.bitbucket.org/2.0' }
    ],
    'confluence': [
        { id: 'email', label: 'Email', value: '' },
        { id: 'token', label: 'API Token', value: '', type: 'password' },
        { id: 'site', label: 'Confluence Site URL', value: 'https://my-org.atlassian.net' }
    ],
    'teams': [
        { id: 'token', label: 'Graph API Token', value: '', type: 'password' },
        { id: 'tenant', label: 'Tenant ID', value: 'common' }
    ],
    'notion': [
        { id: 'token', label: 'Integration Token', value: '', type: 'password' }
    ],
    'sentry': [
        { id: 'token', label: 'Auth Token', value: '', type: 'password' },
        { id: 'org', label: 'Organization Slug', value: '' }
    ],
    'github_actions': [
        { id: 'token', label: 'GitHub PAT', value: '', type: 'password' },
        { id: 'owner', label: 'Repo Owner', value: '' },
        { id: 'repo', label: 'Repo Name', value: '' }
    ],
    'gcp': [
        { id: 'project', label: 'Project ID', value: '' },
        { id: 'token', label: 'Access Token', value: '', type: 'password' }
    ],
    'aws': [
        { id: 'access_key', label: 'Access Key ID', value: '' },
        { id: 'secret_key', label: 'Secret Access Key', value: '', type: 'password' },
        { id: 'region', label: 'Region', value: 'us-east-1' }
    ],
    'azure': [
        { id: 'subscription', label: 'Subscription ID', value: '' },
        { id: 'token', label: 'Access Token', value: '', type: 'password' },
        { id: 'tenant', label: 'Tenant ID', value: '' }
    ],
    'azuredevops': [
        { id: 'org', label: 'Organization URL', value: '' },
        { id: 'project', label: 'Project', value: '' },
        { id: 'token', label: 'PAT', value: '', type: 'password' }
    ],
    'kubernetes': [
        { id: 'api', label: 'API Server URL', value: '' },
        { id: 'token', label: 'Bearer Token', value: '', type: 'password' },
        { id: 'namespace', label: 'Default Namespace', value: 'default' }
    ],
    'elastic': [
        { id: 'url', label: 'Elastic URL', value: 'http://localhost:9200' },
        { id: 'token', label: 'API Key (Optional)', value: '', type: 'password' }
    ],
    'observability': [
        { id: 'url', label: 'Prometheus URL', value: 'http://localhost:9090' }
    ],
    'postgres': [
        { id: 'connection', label: 'Connection String', value: 'postgres://user:pass@host:5432/db', type: 'password' }
    ],
    'testrail': [
        { id: 'site', label: 'TestRail URL', value: '' },
        { id: 'username', label: 'Username', value: '' },
        { id: 'token', label: 'API Key', value: '', type: 'password' },
        { id: 'projectId', label: 'Project ID', value: '' }
    ],
    'docker': [
        { id: 'host', label: 'Docker Host (Optional)', value: 'unix:///var/run/docker.sock' }
    ],
    'zephyr-enterprise': [
        { id: 'site', label: 'Base URL', value: '' },
        { id: 'username', label: 'Username', value: '' },
        { id: 'token', label: 'Token', value: '', type: 'password' },
        { id: 'projectId', label: 'Project ID', value: '' }
    ],
    'github': [
        { id: 'token', label: 'Personal Access Token', value: '', type: 'password' }
    ],
    'stripe': [
        { id: 'token', label: 'Secret Key (sk_live/test_...)', value: '', type: 'password' }
    ]
};

// GET /connect/:provider
router.get('/:provider', (req, res) => {
    const { provider } = req.params;
    const { state } = req.query; // state is user_id
    const fields = PROVIDER_FIELDS[provider] || [];

    if (!fields.length && !['pytest', 'playwright', 'cypress'].includes(provider)) {
        return res.status(404).send("Unknown Provider");
    }

    // HTML Form
    const inputs = fields.map(f => `
        <div class="mb-4">
            <label class="block text-gray-700 text-sm font-bold mb-2">${f.label}</label>
            <input name="${f.id}" type="${f.type || 'text'}" value="${f.value}" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline">
        </div>
    `).join('');

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Connect ${provider}</title>
        <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100 flex items-center justify-center h-screen">
        <div class="bg-white p-8 rounded shadow-md w-96">
            <h2 class="text-2xl mb-4 font-bold flex items-center">
                Connect ${provider.charAt(0).toUpperCase() + provider.slice(1)}
            </h2>
            <form action="/connect/${provider}" method="POST">
                <input type="hidden" name="state" value="${state || ''}">
                ${inputs}
                <button type="submit" class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline w-full">
                    Save & Connect
                </button>
            </form>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// POST /connect/:provider
router.post('/:provider', async (req, res) => {
    const { provider } = req.params;
    const data = req.body;
    const userId = data.state;

    if (!userId) return res.status(400).send("Missing User ID (state)");

    // Encrypt Creds
    const { encryptedData, iv } = encrypt(data);

    try {
        // Ensure User Exists
        await prisma.user.upsert({
            where: { id: userId },
            update: {},
            create: { id: userId }
        });

        // Create or update connection
        await prisma.connection.upsert({
            where: {
                userId_provider: {
                    userId,
                    provider
                }
            },
            update: {
                encryptedData: encryptedData,
                iv: iv.toString('hex'),
                teamId: req.body.teamId || null
            },
            data: {
                provider,
                userId,
                encryptedData: encryptedData, // Fixed: was encrypted
                iv: iv.toString('hex'),
                teamId: req.body.teamId || null // Optional Team Sharing
            }
        });

        // Generate Signature for Safety
        const crypto = require('crypto');
        const hmac = crypto.createHmac('sha256', process.env.ENCRYPTION_KEY);
        hmac.update(`vault-${userId}`);
        const sig = hmac.digest('hex');

        if (req.headers['x-flocca-client'] === 'extension') {
            return res.json({ success: true, provider, userId });
        }

        res.redirect(`/auth/success?source=vault&id=${userId}&sig=${sig}`);
    } catch (e) {
        console.error(`[connect:${provider}] Failed to save connection for user=${userId}:`, e);
        const message = e?.message || 'unknown error';
        if (req.headers['x-flocca-client'] === 'extension') {
            return res.status(500).json({ error: `Failed to save connection: ${message}` });
        }
        res.status(500).send("Failed to save connection: " + message);
    }
});

module.exports = router;
