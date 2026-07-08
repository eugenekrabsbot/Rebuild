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
 * getWireGuardConfig — Return VPN config delivery instructions.
 *
 * VPN configs are delivered manually via email to keep things simple and secure.
 * This endpoint tells the frontend where to direct the user.
 */
const getWireGuardConfig = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await db.query(
      'SELECT vpn_uuid, vpn_username FROM vpn_accounts WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No VPN account found. Please complete payment first.' });
    }

    const { vpn_username: username } = result.rows[0];

    res.json({
      username,
      message: 'VPN configuration files are delivered by email. Please contact support@ahoyvpn.net with your account username and we will send your WireGuard configuration.',
      email: 'support@ahoyvpn.net',
    });
  } catch (err) {
    log.error('getWireGuardConfig error:', { error: err.message });
    res.status(500).json({ error: 'Failed to generate WireGuard config' });
  }
};

/**
 * getOpenVPNConfig — Return VPN config delivery instructions.
 * VPN configs are delivered manually via email.
 */
const getOpenVPNConfig = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await db.query(
      'SELECT vpn_uuid, vpn_username FROM vpn_accounts WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No VPN account found. Please complete payment first.' });
    }

    const { vpn_username: username } = result.rows[0];

    res.json({
      username,
      message: 'VPN configuration files are delivered by email. Please contact support@ahoyvpn.net with your account username and we will send your OpenVPN configuration.',
      email: 'support@ahoyvpn.net',
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
