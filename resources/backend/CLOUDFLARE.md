# Exposing Flocca Backend with Cloudflare Tunnel

We use **Cloudflare Tunnel** (`cloudflared`) to securely expose the backend to `https://api.flocca.app` without opening firewall ports.

## Prerequisites

1.  A Cloudflare account controlling `flocca.app`.
2.  SSH access to your Linux server.

## Step 1: Install `cloudflared` (Linux)

```bash
# Add Cloudflare's repo
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

## Step 2: Login and Create Tunnel

1.  Login (copy the URL printed to your browser):
    ```bash
    cloudflared tunnel login
    ```
2.  Create a tunnel named `flocca-backend`:
    ```bash
    cloudflared tunnel create flocca-backend
    ```
    *   *Save the Tunnel ID printed in the output.*

## Step 3: Configure DNS

Route `api.flocca.app` to your tunnel:

```bash
cloudflared tunnel route dns flocca-backend api.flocca.app
```

## Step 4: Run the Tunnel

Create a configuration file `config.yml` (or run directly).

**Option A: Command Line (Quickest)**

```bash
cloudflared tunnel run --url http://localhost:4000 flocca-backend
```
*(Make sure to use the correct port if you changed it from 4000!)*

**Option B: System Service (Recommended for Production)**

1.  Create `~/.cloudflared/config.yml`:
    ```yaml
    tunnel: <Tunnel-UUID>
    credentials-file: /root/.cloudflared/<Tunnel-UUID>.json
    
    ingress:
      - hostname: api.flocca.app
        service: http://localhost:4000
      - service: http_status:404
    ```

2.  Install as a service:
    ```bash
    sudo cloudflared service install
    sudo systemctl start cloudflared
    ```

## Verification

Visit `https://api.flocca.app/health` in your browser. You should see:
`{"status":"ok" ...}`
