# Changelog

## 0.2.0 (unreleased)

- Device identity and display name are now managed by Relay from the connection
  token; remove `--id`, `--display-name`, and `SILVERMOON_CONNECTOR_ID`.
- Add `$HOME/.silvermoon/connector.yaml` for Relay URL, token, and non-sensitive
  options, with atomic writes and owner-only permissions.
- Preserve `SILVERMOON_CONNECTION_TOKEN` and explicit token files as higher
  priority credential overrides.
- Reject concurrent connections that use the same token without interrupting
  the active connection.

The npm release is intentionally deferred until the remaining `0.2.0` changes
are ready.
