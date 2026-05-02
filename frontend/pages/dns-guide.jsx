import { useState } from 'react';
import { Card } from '../components/ui';

const PLATFORMS = [
  {
    name: 'Windows 11',
    nativeEncryption: '✅ DoH (Settings GUI)',
    easiestMethod: 'Settings → Network → Manual DNS + Encrypted only',
    steps: [
      'Press Win + I to open Settings → Network & internet → Wi‑Fi (or Ethernet if wired).',
      'Click your active network name → scroll to DNS server assignment → click Edit.',
      'Change from Automatic (DHCP) to Manual.',
      'Turn on IPv4 (or IPv6), then enter:',
      '  • Preferred DNS: 1.1.1.1 (or your preferred server)',
      '  • Alternate DNS: 1.0.0.1',
      'Under Encryption, choose Encrypted only (DNS over HTTPS) (or Encrypted, if available on some builds).',
      'When prompted for a provider, either select a listed one (Cloudflare, Google) or choose Custom and paste the DoH template URL (e.g., https://cloudflare-dns.com/dns-query).',
      'Click Save and close Settings.',
      'Note: Windows 10 (21H2 or newer) has similar options. On older builds, use the Control Panel method or upgrade.'
    ]
  },
  {
    name: 'macOS',
    nativeEncryption: '⚠️ Via profile or app',
    easiestMethod: 'Use DNSecure or manual profile',
    steps: [
      'Open System Settings (press Cmd + Space, type "System Settings").',
      'Go to Network → select your active connection (Wi‑Fi or Ethernet) → click Details.',
      'Select the DNS tab.',
      'Click Add (+) and enter your preferred DNS IP addresses (e.g., 1.1.1.1 and 1.0.0.1).',
      'Click OK.',
      'To enable encryption: macOS 11 (Big Sur) and newer support DoH and DoT natively, but the easiest way is to install a configuration profile or use an app like DNSecure (also available for iOS).',
      'For manual configuration, you can create a .mobileconfig profile or use a local DoH proxy.'
    ]
  },
  {
    name: 'iPhone & iPad',
    nativeEncryption: '⚠️ Via profile or app',
    easiestMethod: 'DNSecure (App Store)',
    steps: [
      'Apple\'s iOS doesn\'t offer a native GUI for encrypted DNS, but you can use free apps from the App Store:',
      'DNSecure – Free, supports DoT and DoH, works system‑wide.',
      '1. Download DNSecure from the App Store.',
      '2. Open the app, select or add a DNS server, then enable Use This Server.',
      '3. Go to Settings → General → VPN & Network → DNS.',
      '4. Change from Automatic to DNSecure.',
      'Alternatively, install a configuration profile from your DNS provider (many offer downloadable .mobileconfig files).'
    ]
  },
  {
    name: 'Android (9 and newer)',
    nativeEncryption: '✅ DoT (Private DNS)',
    easiestMethod: 'Settings → Private DNS → enter hostname',
    steps: [
      'Go to Settings → Network & internet → Advanced → Private DNS.',
      'Select Private DNS provider hostname.',
      'Enter a DoT hostname (not an IP address). For example:',
      '  • Cloudflare: one.one.one.one',
      '  • Google: dns.google',
      '  • Quad9: dns.quad9.net',
      'Tap Save.',
      'The setting applies to all Wi‑Fi and mobile networks automatically. Android 11+ also supports DoH via the same Private DNS setting.'
    ]
  },
  {
    name: 'Amazon Fire Stick',
    nativeEncryption: '❌ None natively',
    easiestMethod: 'Use router‑level encryption or Quick DNS Changer app',
    steps: [
      'Fire Stick doesn\'t allow you to change DNS through its own settings menu, but there are two workarounds:',
      'Method 1: Use a DNS‑changing app',
      '  • Download Quick DNS Changer from the Amazon Appstore. It lets you switch DNS servers with a few clicks without manual configuration.',
      'Method 2: Set a static IP (advanced)',
      '  • From the home screen, go to Settings → Network.',
      '  • Select your Wi‑Fi network and forget it.',
      '  • Reconnect to the same network, but choose Advanced options.',
      '  • Switch from DHCP to Static IP, then enter your desired DNS servers (e.g., 1.1.1.1 and 1.0.0.1).',
      'The easiest approach: Let your router handle DNS encryption (see below), which protects the Fire Stick automatically without any per‑device configuration.'
    ]
  },
  {
    name: 'All devices',
    nativeEncryption: '✅ Via Brume 2 router',
    easiestMethod: 'Set ISP router to bridge mode + configure DNS on Brume 2',
    steps: [
      'The smarter solution is to set up a dedicated router that encrypts all DNS traffic for every device on your network—Windows, Mac, iPhone, Android, Fire Stick, smart TVs, game consoles, and everything else.',
      'See the "Router‑Level Encryption" section below for detailed instructions.'
    ]
  }
];

const DNS_PROVIDERS = [
  {
    name: 'Cloudflare',
    ipv4: '1.1.1.1 / 1.0.0.1',
    ipv6: '2606:4700:4700::1111',
    dohTemplate: 'https://cloudflare-dns.com/dns-query',
    dotHostname: 'one.one.one.one',
    features: 'Privacy‑focused, fast'
  },
  {
    name: 'Cloudflare (malware blocking)',
    ipv4: '1.1.1.2 / 1.0.0.2',
    ipv6: '2606:4700:4700::1112',
    dohTemplate: 'https://security.cloudflare-dns.com/dns-query',
    dotHostname: 'security.cloudflare-dns.com',
    features: 'Blocks known malware domains'
  },
  {
    name: 'Cloudflare (family filter)',
    ipv4: '1.1.1.3 / 1.0.0.3',
    ipv6: '2606:4700:4700::1113',
    dohTemplate: 'https://family.cloudflare-dns.com/dns-query',
    dotHostname: 'family.cloudflare-dns.com',
    features: 'Blocks malware + adult content'
  },

  {
    name: 'Quad9',
    ipv4: '9.9.9.9 / 149.112.112.112',
    ipv6: '2620:fe::fe / 2620:fe::9',
    dohTemplate: 'https://dns.quad9.net/dns-query',
    dotHostname: 'dns.quad9.net',
    features: 'Security‑focused, threat blocking'
  }
];

export default function DNSGuide() {
  const [expandedPlatform, setExpandedPlatform] = useState(null);
  const [expandedProvider, setExpandedProvider] = useState(null);

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>DNS Encryption Guide: Protect Your Privacy</h1>
      
      <Card style={styles.sectionCard}>
        <h2 style={styles.sectionTitle}>Why Encrypt Your DNS?</h2>
        <p style={styles.paragraph}>
          Every time you type a website name into your browser, your device asks a DNS (Domain Name System) server to translate that name into an IP address—acting like the internet's phonebook. By default, these DNS requests are sent in plain text, allowing your ISP, network administrators, and anyone listening on your local network to see every site you visit, inject ads, or even redirect you to fake websites.
        </p>
        <p style={styles.paragraph}>
          Two modern encryption standards protect DNS traffic:
        </p>
        <ul style={styles.list}>
          <li><strong>DNS over HTTPS (DoH):</strong> Wraps DNS queries inside HTTPS traffic on port 443, making them blend in with regular web browsing.</li>
          <li><strong>DNS over TLS (DoT):</strong> Uses a dedicated TLS connection on port 853.</li>
        </ul>
        <p style={styles.paragraph}>
          Both methods prevent eavesdropping and tampering. Even better, you can combine encryption with a custom DNS server like Cloudflare (1.1.1.1), Google (8.8.8.8), or Quad9 (9.9.9.9), which often provides faster performance and optional malware filtering.
        </p>
        <p style={styles.paragraph}>
          Below are step‑by‑step instructions for every major platform, followed by a router‑based solution that protects all devices on your network at once—no per‑device configuration required.
        </p>
      </Card>

      <Card style={styles.sectionCard}>
        <h2 style={styles.sectionTitle}>Platform‑by‑Platform Setup</h2>
        <p style={styles.paragraph}>
          Choose your device below for detailed instructions:
        </p>
        
        {PLATFORMS.map((platform, index) => (
          <div key={index} style={styles.platformCard}>
            <div 
              style={styles.platformHeader}
              onClick={() => setExpandedPlatform(expandedPlatform === index ? null : index)}
            >
              <h3 style={styles.platformName}>{platform.name}</h3>
              <div style={styles.platformBadges}>
                <span style={styles.badge}>{platform.nativeEncryption}</span>
                <span style={styles.arrow}>{expandedPlatform === index ? '▲' : '▼'}</span>
              </div>
            </div>
            
            {expandedPlatform === index && (
              <div style={styles.platformContent}>
                <p style={styles.method}><strong>Easiest method:</strong> {platform.easiestMethod}</p>
                <ol style={styles.stepsList}>
                  {platform.steps.map((step, stepIndex) => (
                    <li key={stepIndex} style={styles.step}>{step}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        ))}
      </Card>

      <Card style={styles.sectionCard}>
        <h2 style={styles.sectionTitle}>Router‑Level Encryption: Protect Your Entire Network</h2>
        <p style={styles.paragraph}>
          Configuring each device individually is tedious. The smarter solution is to set up a dedicated router that encrypts all DNS traffic for every device on your network—Windows, Mac, iPhone, Android, Fire Stick, smart TVs, game consoles, and everything else.
        </p>
        
        <h3 style={styles.subsectionTitle}>Recommended Hardware: GL.iNet Brume 2</h3>
        <p style={styles.paragraph}>
          The GL.iNet Brume 2 (MT2500A) is a compact, VPN‑focused router that runs OpenWrt and supports encrypted DNS, WireGuard, and OpenVPN out of the box. Key features:
        </p>
        <ul style={styles.list}>
          <li><strong>WireGuard throughput:</strong> ~355 Mbps – fast enough for 4K streaming and gaming.</li>
          <li><strong>Built‑in encryption:</strong> Cloudflare DNS over TLS/HTTPS, IPv6 support, and cascading server/client modes.</li>
          <li><strong>Ports:</strong> 2.5G WAN, 1G LAN, and USB 3.0.</li>
          <li><strong>Compact design:</strong> Aluminum case, travel‑friendly, easy to place anywhere.</li>
        </ul>
        <p style={styles.paragraph}>
          The Brume 2 works as a VPN gateway—you plug it between your ISP modem and your existing Wi‑Fi router (or replace your router entirely). It then handles all DNS lookups with encryption, optionally routing traffic through a VPN.
        </p>
        
        <h3 style={styles.subsectionTitle}>Step 1: Put Your ISP Router into Bridge Mode (or IP Passthrough)</h3>
        <p style={styles.paragraph}>
          Most ISP‑provided routers are combination modem/router units. To use the Brume 2 as your primary router, you need to disable the ISP router's routing functions. This is called bridge mode or IP passthrough.
        </p>
        <ol style={styles.list}>
          <li>Log into your ISP router's admin page (usually 192.168.0.1 or 192.168.1.1 – check the sticker on the device).</li>
          <li>Navigate to Advanced Settings → Network → WAN.</li>
          <li>Look for an option labeled Bridge Mode, Modem Mode, or IP Passthrough.</li>
          <li>Enable it and save the settings. The router will likely restart—this is normal.</li>
        </ol>
        <p style={styles.paragraph}>
          <strong>⚠️</strong> Some ISP routers don't offer bridge mode. If that's your case, manually disable DHCP and disable NAT on the ISP router, then set the Brume 2's WAN IP to a static address on the ISP's subnet.
        </p>
        
        <h3 style={styles.subsectionTitle}>Step 2: Connect the Brume 2</h3>
        <ol style={styles.list}>
          <li>Using an Ethernet cable, connect the LAN port of your ISP router to the WAN port of the Brume 2.</li>
          <li>Power on the Brume 2.</li>
          <li>Connect your computer or existing Wi‑Fi router to one of the Brume 2's LAN ports.</li>
        </ol>
        <p style={styles.paragraph}>
          The Brume 2 now becomes the "brain" of your network—it handles NAT, DHCP, firewalls, and DNS encryption.
        </p>
        
        <h3 style={styles.subsectionTitle}>Step 3: Configure Encrypted DNS on the Brume 2</h3>
        <ol style={styles.list}>
          <li>Access the Brume 2 admin panel (default IP: 192.168.8.1).</li>
          <li>Go to Network → DNS.</li>
          <li>Under DNS Encryption, enable DNS over TLS or DNS over HTTPS.</li>
          <li>Enter your preferred DNS servers (Cloudflare, Quad9, Google, etc.). The Brume 2 will encrypt all queries automatically.</li>
          <li>(Optional) Configure a VPN client (WireGuard or OpenVPN) on the Brume 2 to tunnel all traffic through a VPN provider.</li>
        </ol>
        <p style={styles.paragraph}>
          Once configured, every device on your network—including the Fire Stick—uses encrypted DNS without any additional setup.
        </p>
        <p style={styles.paragraph}>
          By setting up the GL.iNet Brume 2 and putting your ISP router into bridge mode, you encrypt DNS for every device on your network automatically—no per‑device tinkering required. It's the most complete and maintenance‑free solution for protecting your privacy across all platforms.
        </p>
      </Card>

      <Card style={styles.sectionCard}>
        <h2 style={styles.sectionTitle}>Recommended DNS Providers</h2>
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Provider</th>
                <th style={styles.th}>IPv4</th>
                <th style={styles.th}>IPv6</th>
                <th style={styles.th}>DoH Template</th>
                <th style={styles.th}>DoT Hostname</th>
                <th style={styles.th}>Features</th>
              </tr>
            </thead>
            <tbody>
              {DNS_PROVIDERS.map((provider, index) => (
                <tr key={index}>
                  <td style={styles.td}><strong>{provider.name}</strong></td>
                  <td style={styles.td}>{provider.ipv4}</td>
                  <td style={styles.td}>{provider.ipv6}</td>
                  <td style={styles.td}>
                    <code style={styles.code}>{provider.dohTemplate}</code>
                  </td>
                  <td style={styles.td}>
                    <code style={styles.code}>{provider.dotHostname}</code>
                  </td>
                  <td style={styles.td}>{provider.features}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card style={styles.sectionCard}>
        <h2 style={styles.sectionTitle}>Verify That Encryption Is Working</h2>
        <p style={styles.paragraph}>
          After configuring DNS on any platform, test it with online DNS leak test tools:
        </p>
        <ul style={styles.list}>
          <li>
            <strong>Cloudflare's help page:</strong>{' '}
            <a href="https://www.cloudflare.com/ssl/encrypted-sni/" target="_blank" rel="noreferrer" style={styles.link}>
              https://www.cloudflare.com/ssl/encrypted-sni/
            </a>{' '}
            (look for "DNS over HTTPS" status)
          </li>
          <li>
            <strong>DNSLeakTest.com:</strong>{' '}
            <a href="https://www.dnsleaktest.com" target="_blank" rel="noreferrer" style={styles.link}>
              https://www.dnsleaktest.com
            </a>{' '}
            (shows which DNS servers your device is actually using)
          </li>
        </ul>
        <p style={styles.paragraph}>
          On Windows, you can also run <code style={styles.inlineCode}>nslookup example.com</code> in Command Prompt and check that the response comes from your chosen DNS provider.
        </p>
      </Card>

      <Card style={styles.sectionCard}>
        <h2 style={styles.sectionTitle}>Need Help?</h2>
        <p style={styles.paragraph}>
          If you have questions about DNS encryption or need assistance with AHOY VPN, email us at{' '}
          <a href="mailto:ahoyvpn@ahoyvpn.net" style={styles.link} aria-label="Email AhoyVPN support">
            ahoyvpn@ahoyvpn.net
          </a>.
        </p>
      </Card>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '1000px',
    margin: '0 auto',
    padding: '2rem 1rem',
    backgroundColor: '#121212',
    borderRadius: '8px',
    // debug outline removed
  },
  title: {
    fontSize: '2.5rem',
    fontWeight: '700',
    marginBottom: '1.5rem',
    color: '#1E90FF', // accent blue
    textAlign: 'center',
  },
  sectionCard: {
    marginBottom: '2rem',
    padding: '2rem',
    backgroundColor: '#1A1A1A', // dark card background
    borderRadius: '12px',
    border: '1px solid #333333',
  },
  sectionTitle: {
    fontSize: '1.8rem',
    fontWeight: '600',
    marginBottom: '1rem',
    color: '#F0F4F8', // primary text color
  },
  subsectionTitle: {
    fontSize: '1.4rem',
    fontWeight: '600',
    marginTop: '1.5rem',
    marginBottom: '0.75rem',
    color: '#F0F4F8',
  },
  paragraph: {
    fontSize: '1rem',
    lineHeight: '1.6',
    marginBottom: '1rem',
    color: '#F0F4F8',
  },
  list: {
    marginLeft: '1.5rem',
    marginBottom: '1rem',
    color: '#F0F4F8',
    lineHeight: '1.6',
  },
  platformCard: {
    border: '1px solid #333333',
    borderRadius: '8px',
    marginBottom: '1rem',
    overflow: 'hidden',
    backgroundColor: '#252525', // card background
  },
  platformHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem',
    backgroundColor: '#252525',
    cursor: 'pointer',
    borderBottom: '1px solid #444',
  },
  platformName: {
    fontSize: '1.2rem',
    fontWeight: '600',
    margin: 0,
    color: '#F0F4F8',
  },
  platformBadges: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  badge: {
    backgroundColor: '#3A3A3A', // darker gray
    padding: '0.25rem 0.75rem',
    borderRadius: '4px',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#F0F4F8',
  },
  arrow: {
    fontSize: '1rem',
    color: '#F0F4F8',
  },
  platformContent: {
    padding: '1.5rem',
    backgroundColor: '#1A1A1A',
  },
  method: {
    fontSize: '1rem',
    marginBottom: '1rem',
    color: '#B0C4DE', // secondary text color
  },
  stepsList: {
    marginLeft: '1.5rem',
    color: '#F0F4F8',
    lineHeight: '1.6',
  },
  step: {
    marginBottom: '0.5rem',
  },
  tableContainer: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.9rem',
  },
  th: {
    border: '1px solid #333333',
    padding: '0.75rem',
    backgroundColor: '#252525',
    fontWeight: '600',
    textAlign: 'left',
    color: '#F0F4F8',
  },
  td: {
    border: '1px solid #333333',
    padding: '0.75rem',
    backgroundColor: '#1A1A1A',
    color: '#F0F4F8',
  },
  code: {
    backgroundColor: '#252525',
    padding: '0.2rem 0.4rem',
    borderRadius: '4px',
    fontSize: '0.85rem',
    fontFamily: 'monospace',
    color: '#B0C4DE',
  },
  inlineCode: {
    backgroundColor: '#252525',
    padding: '0.2rem 0.4rem',
    borderRadius: '4px',
    fontSize: '0.85rem',
    fontFamily: 'monospace',
    color: '#B0C4DE',
  },
  link: {
    color: '#1E90FF',
    textDecoration: 'none',
  },
  emailLink: {
    color: '#1E90FF',
    textDecoration: 'none',
    fontWeight: '500',
  },
};