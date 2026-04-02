/**
 * Parse various proxy protocol URLs into mihomo proxy format
 */

export function parseProxyUrl(url) {
  if (url.startsWith('vmess://')) return parseVmess(url);
  if (url.startsWith('ss://')) return parseSS(url);
  if (url.startsWith('trojan://')) return parseTrojan(url);
  if (url.startsWith('vless://')) return parseVless(url);
  throw new Error(`Unsupported protocol: ${url.split('://')[0]}`);
}

function parseVmess(url) {
  const b64 = url.replace('vmess://', '');
  const data = JSON.parse(Buffer.from(b64, 'base64').toString());
  return {
    name: data.ps || `vmess-${data.add}`,
    type: 'vmess',
    server: data.add,
    port: parseInt(data.port),
    uuid: data.id,
    alterId: parseInt(data.aid || 0),
    cipher: data.scy || 'auto',
    udp: true,
    ...(data.net === 'ws' ? {
      network: 'ws',
      'ws-opts': {
        path: data.path || '/',
        ...(data.host ? { headers: { Host: data.host } } : {})
      }
    } : {}),
    ...(data.tls === 'tls' ? { tls: true, servername: data.sni || data.host || data.add } : {})
  };
}

function parseSS(url) {
  // ss://base64(method:password)@server:port#name
  // or ss://base64(method:password@server:port)#name
  const cleaned = url.replace('ss://', '');
  const [main, fragment] = cleaned.split('#');
  const name = fragment ? decodeURIComponent(fragment) : undefined;

  let method, password, server, port;

  if (main.includes('@')) {
    const [userinfo, hostport] = main.split('@');
    const decoded = Buffer.from(userinfo, 'base64').toString();
    [method, password] = decoded.split(':');
    [server, port] = hostport.split(':');
  } else {
    const decoded = Buffer.from(main, 'base64').toString();
    const match = decoded.match(/^(.+?):(.+?)@(.+?):(\d+)$/);
    if (match) {
      [, method, password, server, port] = match;
    }
  }

  return {
    name: name || `ss-${server}`,
    type: 'ss',
    server,
    port: parseInt(port),
    cipher: method,
    password,
    udp: true
  };
}

function parseTrojan(url) {
  const u = new URL(url);
  return {
    name: u.hash ? decodeURIComponent(u.hash.slice(1)) : `trojan-${u.hostname}`,
    type: 'trojan',
    server: u.hostname,
    port: parseInt(u.port),
    password: u.username,
    udp: true,
    sni: u.searchParams.get('sni') || u.hostname,
    'skip-cert-verify': u.searchParams.get('allowInsecure') === '1'
  };
}

function parseVless(url) {
  const u = new URL(url);
  return {
    name: u.hash ? decodeURIComponent(u.hash.slice(1)) : `vless-${u.hostname}`,
    type: 'vless',
    server: u.hostname,
    port: parseInt(u.port),
    uuid: u.username,
    udp: true,
    tls: u.searchParams.get('security') === 'tls',
    servername: u.searchParams.get('sni') || u.hostname,
    flow: u.searchParams.get('flow') || '',
    ...(u.searchParams.get('type') === 'ws' ? {
      network: 'ws',
      'ws-opts': {
        path: u.searchParams.get('path') || '/',
        headers: { Host: u.searchParams.get('host') || u.hostname }
      }
    } : {})
  };
}

export async function fetchSubscription(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Subscription fetch failed: ${res.status}`);
  const text = await res.text();

  // Try YAML (clash/mihomo format)
  if (text.includes('proxies:')) {
    return { format: 'clash', raw: text };
  }

  // Try base64 encoded list
  try {
    const decoded = Buffer.from(text.trim(), 'base64').toString();
    const lines = decoded.split('\n').filter(l => l.trim());
    const proxies = lines.map(l => parseProxyUrl(l.trim())).filter(Boolean);
    return { format: 'base64', proxies };
  } catch {}

  // Try line-by-line URLs
  const lines = text.split('\n').filter(l => l.trim().match(/^(vmess|ss|trojan|vless):\/\//));
  if (lines.length) {
    const proxies = lines.map(l => parseProxyUrl(l.trim())).filter(Boolean);
    return { format: 'urls', proxies };
  }

  throw new Error('Unable to parse subscription format');
}
