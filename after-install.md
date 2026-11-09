# Finish enabling Projects

The installer prepares the Python backend through Hermes PM. No Node installation,
frontend build, ChatHermes service, credentials or environment variables are needed.

Restart the serving Hermes gateway (`hermes gateway restart` for a managed gateway;
restart `hermes gateway run` yourself if running it in the foreground) so the shared
server discovers `/api/plugins/hermes-projects/*`. Quit and reopen Desktop, or
reload the Webapp. Enable **Projects** in **Capabilities → Plugins**; the Desktop
half has its own opt-in even after `--enable` selects the backend. Use the same
connection/profile where you installed the plugin.

If PM refuses dependency resolution, resolve that error before enabling; do not
bypass it with a manual pip install or `--no-deps`. The plugin requires the native
project services and SDK from the audited Hermes distribution; see README.md.
