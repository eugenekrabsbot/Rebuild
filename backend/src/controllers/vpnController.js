const vpnResellersService = new (require('../services/vpnResellersService'))();
const log = require('../utils/logger');
const db = require('../config/database');

/**
 * MOCK_SERVERS — Static server list for development/testing.
 * Replace with a real server inventory API call when VPN provider
 * exposes one. Using static list allows frontend to build UI without
 * waiting for infrastructure.
 */
const MOCK_SERVERS = [
  {
    id: 'us-east-1',
    name: 'US East (New York)',
    protocol: 'wireguard',
    host: 'us-east.vpn.example.com',
    port: 51820,
    publicKey: 'EXAMPLE_US_EAST_PUBLIC_KEY',
    load: 45,
    country: 'US',
  },
  {
    id: 'us-west-1',
    name: 'US West (Los Angeles)',
    protocol: 'wireguard',
    host: 'us-west.vpn.example.com',
    port: 51820,
    publicKey: 'EXAMPLE_US_WEST_PUBLIC_KEY',
    load: 22,
    country: 'US',
  },
  {
    id: 'eu-central-1',
    name: 'EU Central (Frankfurt)',
    protocol: 'wireguard',
    host: 'eu.vpn.example.com',
    port: 51820,
    publicKey: 'EXAMPLE_EU_PUBLIC_KEY',
    load: 61,
    country: 'DE',
  },
];

/**
 * getServers — Return list of available VPN servers.
 * Currently returns static mock data. Replace with real
 * server inventory API when VPN provider exposes it.
 */
const getServers = async (req, res) => {
  res.json({ servers: MOCK_SERVERS });
};

/**
 * getWireGuardConfig — Generate WireGuard config for authenticated user.
 * 
 * Flow:
 * 1. Look up vpn_accounts table for this user (by req.user.id from auth middleware)
 * 2. Call vpnResellersService.getAccount(vpn_uuid) to get live credentials
 * 3. Return WireGuard config text
 */
const getWireGuardConfig = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Look up the user's VPN account in our database
    const result = await db.query(
      'SELECT vpn_uuid, vpn_username, vpn_password FROM vpn_accounts WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No VPN account found. Please complete payment first.' });
    }

    const { vpn_uuid: accountId, vpn_username: dbUsername, vpn_password: dbPassword } = result.rows[0];

    // Fetch live account details from VPN Resellers API
    const apiResponse = await vpnResellersService.getAccount(accountId);
    const account = apiResponse?.data || apiResponse;

    // VPNResellers API returns wg_private_key (client private key), wg_public_key (client pub key),
    // and wg_ip (client WireGuard IP). The server's WireGuard public key and hostname must
    // be obtained from VPNResellers — they do not expose a server list API.
    // TODO: Replace SERVER_PUBLIC_KEY and SERVER_HOSTNAME with values from VPNResellers.
    const clientPrivateKey = account.wg_private_key || '';
    const clientAddress = account.wg_ip ? `${account.wg_ip}/32` : '';

    const wgConfig = [
      '[Interface]',
      `PrivateKey = ${clientPrivateKey || '<YOUR_WG_PRIVATE_KEY>'}`,
      `Address = ${clientAddress || '<YOUR_WG_IP>/32'}`,
      'DNS = 1.1.1.1',
      '',
      '[Peer]',
      // Replace these placeholders with your server's WireGuard public key and hostname
      `PublicKey = SERVER_PUBLIC_KEY`,
      `Endpoint = SERVER_HOSTNAME:51820`,
      'AllowedIPs = 0.0.0.0/0',
      'PersistentKeepalive = 25',
    ].join('\n');

    res.json({
      config: wgConfig,
      username: dbUsername || account.username,
      password: dbPassword || account.password,
      clientAddress,
      note: 'Replace SERVER_PUBLIC_KEY and SERVER_HOSTNAME with values from VPNResellers. Server public key and hostname are not returned by the VPNResellers API — contact VPNResellers support to obtain them.',
    });
  } catch (err) {
    log.error('getWireGuardConfig error:', { error: err.message });
    res.status(500).json({ error: 'Failed to generate WireGuard config' });
  }
};

/**
 * getOpenVPNConfig — Generate OpenVPN config for authenticated user.
 * Same pattern as WireGuard but .ovpn format.
 */
const getOpenVPNConfig = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await db.query(
      'SELECT vpn_uuid, vpn_username, vpn_password FROM vpn_accounts WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No VPN account found. Please complete payment first.' });
    }

    const { vpn_uuid: accountId, vpn_username: dbUsername, vpn_password: dbPassword } = result.rows[0];
    const apiResponse = await vpnResellersService.getAccount(accountId);
    const account = apiResponse?.data || apiResponse;

    // OpenVPN config requires CA cert, client cert, and client key from VPNResellers.
    // VPNResellers does not currently expose these via API.
    // Replace SERVER_HOSTNAME with your server hostname from VPNResellers.
    const ovpnConfig = [
      'client',
      'dev tun',
      'proto udp',
      'remote SERVER_HOSTNAME 1194',
      'resolv-retry infinite',
      'nobind',
      'persist-key',
      'persist-tun',
      'remote-cert-tls server',
      'cipher AES-256-GCM',
      'auth SHA256',
      'verb 3',
      '',
      '# TODO: Replace CA cert, client cert, and client key with values from VPNResellers.',
      '# OpenVPN credentials are not yet available via API — contact VPNResellers support.',
    ].join('\n');

    res.json({
      config: ovpnConfig,
      username: dbUsername || account.username,
      password: dbPassword || account.password,
      note: 'OpenVPN credentials (CA cert, client cert, client key) are not yet available via API. Contact VPNResellers support to obtain them.',
    });
  } catch (err) {
    log.error('getOpenVPNConfig error:', { error: err.message });
    res.status(500).json({ error: 'Failed to generate OpenVPN config' });
  }
};

/**
 * connect — Client VPN connection tracking.
 * 
 * Currently a stub. Real implementation requires a VPN daemon running
 * on the server to track active connections. This endpoint exists as a
 * placeholder for when daemon integration is added.
 * 
 * TODO: Integrate with WireGuard/OpenVPN daemon for connection state tracking.
 */
const connect = async (req, res) => {
  res.status(501).json({
    error: 'VPN connect/disconnect requires daemon integration — not yet implemented',
    note: 'Track your connection in the desktop VPN client instead',
  });
};

/**
 * disconnect — Stub for VPN connection termination.
 * @see connect
 */
const disconnect = async (req, res) => {
  res.status(501).json({
    error: 'VPN connect/disconnect requires daemon integration — not yet implemented',
    note: 'Track your connection in the desktop VPN client instead',
  });
};

/**
 * getConnections — Stub for listing active VPN connections.
 * @see connect
 */
const getConnections = async (req, res) => {
  res.status(501).json({
    error: 'VPN connection tracking requires daemon integration — not yet implemented',
    note: 'Connection state is managed by the desktop VPN client',
  });
};

module.exports = {
  getServers,
  getWireGuardConfig,
  getOpenVPNConfig,
  connect,
  disconnect,
  getConnections,
};
