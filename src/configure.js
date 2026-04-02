import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from './platform.js';
import { parseProxyUrl, fetchSubscription } from './subscribe.js';
import { log } from './logger.js';

const CONFIG_TEMPLATE = `mixed-port: 7890
allow-lan: false
bind-address: '*'
mode: rule
log-level: info
external-controller: 0.0.0.0:9090
unified-delay: true
tcp-concurrent: true
ipv6: true

dns:
  enable: true
  ipv6: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - 223.5.5.5
    - 119.29.29.29
  fallback:
    - https://cloudflare-dns.com/dns-query
    - https://dns.google/dns-query
  fallback-filter:
    geoip: true
    geoip-code: CN

tun:
  enable: true
  stack: system
  dns-hijack:
    - any:53
  auto-route: true
  auto-detect-interface: true

proxies: []

proxy-groups:
  - name: 🚀节点选择
    type: select
    proxies:
      - ♻️自动选择
      - DIRECT

  - name: ♻️自动选择
    type: url-test
    url: https://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    proxies: []

rules:
  - GEOIP,cn,DIRECT
  - MATCH,🚀节点选择
`;

export async function configure(subscriptionUrl, config) {
  const configDir = getConfigDir();
  const configPath = config?.mihomo?.configPath || join(configDir, 'config.yaml');

  log(`Fetching subscription: ${subscriptionUrl}`);
  const sub = await fetchSubscription(subscriptionUrl);

  let yamlContent;

  if (sub.format === 'clash') {
    // Already in clash format, use directly
    yamlContent = sub.raw;
    log('Using subscription config directly (clash format)');
  } else {
    // Build from template + parsed proxies
    const proxyNames = sub.proxies.map(p => p.name);
    let content = CONFIG_TEMPLATE;

    // Simple YAML manipulation (avoid heavy deps)
    const proxyLines = sub.proxies.map(p => {
      const entries = Object.entries(p).map(([k, v]) => {
        if (typeof v === 'object') return `    ${k}: ${JSON.stringify(v)}`;
        if (typeof v === 'boolean') return `    ${k}: ${v}`;
        if (typeof v === 'number') return `    ${k}: ${v}`;
        return `    ${k}: "${v}"`;
      });
      return `  - ${entries.join('\n    ')}`;
    });

    // Inject proxies
    content = content.replace('proxies: []', 'proxies:\n' + sub.proxies.map(p =>
      '  - ' + JSON.stringify(p).replace(/,"/g, ', "')
    ).join('\n'));

    // Inject proxy names into groups
    const namesList = proxyNames.map(n => `      - ${n}`).join('\n');
    content = content.replace(
      "  - name: 🚀节点选择\n    type: select\n    proxies:\n      - ♻️自动选择\n      - DIRECT",
      `  - name: 🚀节点选择\n    type: select\n    proxies:\n      - ♻️自动选择\n      - DIRECT\n${namesList}`
    );
    content = content.replace(
      "  - name: ♻️自动选择\n    type: url-test\n    url: https://www.gstatic.com/generate_204\n    interval: 300\n    tolerance: 50\n    proxies: []",
      `  - name: ♻️自动选择\n    type: url-test\n    url: https://www.gstatic.com/generate_204\n    interval: 300\n    tolerance: 50\n    proxies:\n${namesList}`
    );

    yamlContent = content;
  }

  writeFileSync(configPath, yamlContent);
  log(`Config written to ${configPath}`);

  const nodeCount = (yamlContent.match(/- name:/g) || []).length;
  const groupCount = (yamlContent.match(/type: (select|url-test|fallback)/g) || []).length;

  return { configured: true, nodes: nodeCount, groups: groupCount, path: configPath };
}

export async function addNode(proxyUrl, config) {
  const configPath = config?.mihomo?.configPath || join(getConfigDir(), 'config.yaml');

  if (!existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}. Run 'mihomod config' first.`);
  }

  const proxy = parseProxyUrl(proxyUrl);
  log(`Parsed: ${proxy.name} (${proxy.type}) -> ${proxy.server}:${proxy.port}`);

  let content = readFileSync(configPath, 'utf8');

  // Append proxy to proxies list
  const proxyYaml = '  - ' + JSON.stringify(proxy).replace(/,"/g, ', "');
  content = content.replace(/(proxies:\n)/, `$1${proxyYaml}\n`);

  // Add to selector groups
  const nameEntry = `      - ${proxy.name}`;
  content = content.replace(/(🚀节点选择[\s\S]*?proxies:\n)/,`$1${nameEntry}\n`);
  content = content.replace(/(♻️自动选择[\s\S]*?proxies:\n)/, `$1${nameEntry}\n`);

  writeFileSync(configPath, content);

  return { added: true, name: proxy.name, type: proxy.type, server: proxy.server, port: proxy.port };
}
