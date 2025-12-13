const express = require('express');
const router = express.Router();
const { decrypt } = require('../../utils/crypto');
const axios = require('axios');
const prisma = require('../db');

// ANY /proxy/:provider/*
router.all('/:provider/*', async (req, res) => {
    const { provider } = req.params;
    const userId = req.headers['x-flocca-user-id'];

    if (!userId) return res.status(401).send("Missing X-Flocca-User-ID header");

    try {
        // 1. Fetch Credentials
        const connection = await prisma.connection.findUnique({
            where: { userId_provider: { userId, provider } }
        });

        if (!connection) {
            return res.status(404).send(`No connection found for provider: ${provider}`);
        }

        // 2. Decrypt
        let creds;
        try {
            creds = decrypt(connection.encryptedData, connection.iv);
        } catch (e) {
            return res.status(500).send("Failed to decrypt credentials");
        }

        // 3. Construct Target URL
        const path = req.params[0]; // Captured by *
        // Base URL from creds (e.g. site, url, service_url) or fallback
        let baseUrl = creds.site || creds.url || creds.service_url || creds.base_url;

        // Special defaults if not in creds (e.g. pure token providers)
        if (!baseUrl) {
            if (provider === 'github') baseUrl = 'https://api.github.com';
            if (provider === 'slack') baseUrl = 'https://slack.com/api';
            if (provider === 'gitlab') baseUrl = 'https://gitlab.com/api/v4';
            if (provider === 'notion') baseUrl = 'https://api.notion.com/v1'; // Notion usually adds v1
            if (provider === 'gitlab') baseUrl = 'https://gitlab.com/api/v4';
            if (provider === 'notion') baseUrl = 'https://api.notion.com/v1'; // Notion usually adds v1

            // AWS fallback: if path looks like a domain, use https://
            if (provider === 'aws') {
                // Do not set a single base URL, instead ensure prefix
                baseUrl = 'https://'; // Hacky but allows dynamic target
            }
        }

        // AWS Special case: if baseUrl is just https://, don't double slash
        if (provider === 'aws' && !creds.url) {
            baseUrl = ''; // We will manually prepend https:// to path
        }

        // Remove trailing slash from base, leading from path
        if (baseUrl && baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;

        // AWS Fix: Ensure we form a valid URL
        let targetUrl = `${baseUrl}/${cleanPath}`;

        if (provider === 'aws') {
            // If no base URL, we assume path is the domain
            if (!baseUrl) {
                targetUrl = `https://${cleanPath}`;
            }
        }

        // 4. Construct Headers
        const headers = { ...req.headers };
        delete headers['host']; // Don't forward host
        delete headers['x-flocca-user-id'];
        delete headers['content-length']; // Axios adds this

        // Inject Auth
        // Logic depends on provider, but usually Bearer or Basic
        if (creds.token) {
            headers['Authorization'] = `Bearer ${creds.token}`;
        } else if (creds.password) {
            // Basic Auth (e.g. Bitbucket)
            const user = creds.username || creds.email || '';
            const auth = Buffer.from(`${user}:${creds.password}`).toString('base64');
            headers['Authorization'] = `Basic ${auth}`;
        } else if (creds.access_key && creds.secret_key && provider === 'aws') {
            // AWS Signature V4
            const aws4 = require('aws4');

            // Infer service and region from URL if possible, or use defaults
            // URL format: https://service.region.amazonaws.com or https://api-id.execute-api.region.amazonaws.com
            // We can parse the hostname.
            const urlObj = new URL(targetUrl);
            const hostParts = urlObj.hostname.split('.');

            let service = 'execute-api'; // Default common for proxies
            let region = creds.region || 'us-east-1';

            if (hostParts.length >= 4 && hostParts[hostParts.length - 1] === 'com' && hostParts[hostParts.length - 2] === 'amazonaws') {
                // e.g. lambda.us-east-1.amazonaws.com -> service=lambda, region=us-east-1
                if (hostParts.length === 4) {
                    service = hostParts[0];
                    region = hostParts[1];
                }
                // e.g. some-api.execute-api.us-east-1.amazonaws.com
                else if (urlObj.hostname.includes('execute-api')) {
                    service = 'execute-api';
                    // region is usually before amazonaws.com
                    region = hostParts[hostParts.length - 3];
                }
            }

            // Determine Body format
            const contentType = req.headers['content-type'] || 'application/json';
            let bodyData;

            if (req.body) {
                if (contentType.includes('application/x-www-form-urlencoded')) {
                    // Re-serialize object to form string
                    bodyData = new URLSearchParams(req.body).toString();
                } else {
                    bodyData = JSON.stringify(req.body);
                }
            }

            const opts = {
                host: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                service,
                region,
                method: req.method,
                body: bodyData,
                headers: {
                    'Content-Type': contentType
                }
            };

            // Sign
            aws4.sign(opts, { accessKeyId: creds.access_key, secretAccessKey: creds.secret_key });

            // Apply signed headers
            Object.assign(headers, opts.headers);
        }

        // 5. Forward Request
        const response = await axios({
            method: req.method,
            url: targetUrl,
            headers,
            data: headers['Content-Type'].includes('form') ? new URLSearchParams(req.body).toString() : req.body, // Axios usually handles objects for JSON automatically, but for form we should be explicit to match signature? 
            // Better: use the 'opts.body' we just calculated? No, 'opts' was for signing.
            // Axios 'data' can be the raw string we signed to be safe.
            data: creds.access_key && provider === 'aws' ?
                (headers['Content-Type'].includes('application/x-www-form-urlencoded') ? new URLSearchParams(req.body).toString() : req.body)
                : req.body,

            params: req.query,
            validateStatus: () => true // Pass all statuses back
        });

        // Strip headers that cause conflicts or are hop-by-hop
        const responseHeaders = { ...response.headers };
        delete responseHeaders['content-length'];
        delete responseHeaders['transfer-encoding'];
        delete responseHeaders['content-encoding']; // Let Express handle compression
        delete responseHeaders['connection'];

        res.status(response.status).set(responseHeaders).send(response.data);

    } catch (e) {
        console.error(`Proxy Error [${provider}]:`, e.message);
        res.status(502).send(`Proxy Error: ${e.message}`);
    }
});

module.exports = router;
