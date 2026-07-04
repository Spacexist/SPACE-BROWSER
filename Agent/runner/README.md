# Agent Runner

`Agent/runner` is the CDP execution backend for `AgentHand`.

## Files

- `runner.js`: browser-side `window.AgentRunner` bridge
- `config.json`: default browser-side runner config
- `service/start.js`: local Node HTTP service entrypoint
- `service/chrome-runner.js`: CDP-backed action service
- `service/cdp-client.js`: low-level Chrome DevTools client

## Start

1. Start Chrome with remote debugging:

```powershell
chrome.exe --remote-debugging-port=9222
```

2. Start the local runner service:

```powershell
node Agent/runner/service/start.js
```

3. In the app test panel:

- set `backend` to `cdp`
- keep `runner endpoint` as `http://127.0.0.1:17373`
- keep `debug url` as `http://127.0.0.1:9222`
- click `Connect Runner`

## Current actions

- `move`
- `click`
- `hold`
- `release`
- `drag`
- `scroll`
- `type`

## Notes

- This backend sends real Chrome-level input through CDP.
- The top-level app page computes card semantics and coordinates first.
- The runner does not replace `AgentHand`; it executes resolved actions for it.
