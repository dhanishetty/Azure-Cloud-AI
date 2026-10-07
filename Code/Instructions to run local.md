# Instructions to run local

---

## Frontend with Docker

```bash
cd Code/Frontend
docker build -t dhanishetty-frontend .
docker run --rm -p 8080:80 -e BACKEND_URL=http://host.docker.internal:8000 dhanishetty-frontend
```

Then open http://localhost:8080.

- **`BACKEND_URL`:** nginx proxies `/api/` to this address. Without `-e`, it defaults to
  `http://backend-api:8000`, which only resolves inside a docker-compose network. Outside
  compose, nginx can fail to start with a "host not found in upstream" error, so always
  pass `-e BACKEND_URL=...`.
- **No backend running:** the page still loads, but document and chat calls show errors.
- **Backend on Azure:** point `BACKEND_URL` at its HTTPS URL (the nginx config already has
  `proxy_ssl_server_name on`).

## Frontend without Docker (dev server)

```bash
cd Code/Frontend
npm install
npm run dev          # http://localhost:5173, proxies /api to http://localhost:8000
```

Different backend:

```bash
BACKEND_URL=https://my-backend.example.com npm run dev
```

Production build and type-check:

```bash
npm run build        # output in dist/
```

## Full stack with docker compose

The `docker-compose.yml` in `rag-qa-app` builds the frontend from `./frontend`. To use the
new frontend, change the build path to `Code/Frontend` (or wherever you consolidate), then:

```bash
docker compose up --build
```

## Notes

- Use the **dhanishetty@gmail.com** Azure account for this project, not the work account.
- More detail on the frontend structure and adding feature tabs: `Frontend/MIGRATION-GUIDE.md`.

## Troubleshooting

### Page shows "Server is up and running." instead of the app
- Something else is answering on that port, or a stale image/container is running.
- Make sure the image name in `docker run` matches the one you built (`dhanishetty-frontend`).
- Check what is running: `docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'`
- Stop the old container (`docker stop <name>`), then hard-refresh with Ctrl+Shift+R
  or use a private window to rule out browser cache.

### Page flashes, then goes blank
- This means a JavaScript error crashed React. Open DevTools (F12) -> Console to see it.
- Headless check without a browser UI:
  ```bash
  chrome --headless=new --enable-logging=stderr --v=0 --virtual-time-budget=8000 --dump-dom http://localhost:8080/ 2>&1 | grep CONSOLE
  ```
- Minified errors (e.g. `l is not a function`) are hard to read. Run `npm run dev` and
  open http://localhost:5173 to get the unminified message and stack.
- Known cause, already fixed: a `useEffect` written as `useEffect(() => someCall(), [dep])`
  returns the call's result, which React treats as a cleanup function
  (`destroy is not a function`). Use a block body so nothing is returned:
  `useEffect(() => { someCall(); }, [dep])`.
- After any code fix, rebuild the image and restart the container. Restarting alone keeps
  the old build.

#### To get a fix into Docker: rebuild and rerun

```bash
cd Code/Frontend
docker build -t dhanishetty-frontend .
docker ps -q --filter ancestor=dhanishetty-frontend | xargs -r docker stop
docker run --rm -p 8080:80 -e BACKEND_URL=http://host.docker.internal:8000 dhanishetty-frontend
```

If `docker stop` complains "requires at least 1 argument", no container is running. That is
fine, skip it and run the last command. (`xargs -r` skips the stop when nothing is running.)

Then hard-refresh the browser with Ctrl+Shift+R.

### 502 Bad Gateway on /api/...
- The frontend is fine but nothing is answering at `BACKEND_URL`.
- Start the backend, or set `BACKEND_URL` to a reachable address
  (`http://host.docker.internal:8000` for a backend on your machine).
- Test it directly: `curl localhost:8080/api/info`.

### nginx exits with "host not found in upstream"
- `BACKEND_URL` was not set, so it defaulted to `http://backend-api:8000`, which only resolves
  inside docker compose. Pass `-e BACKEND_URL=...`.
