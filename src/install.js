import { getPlatform, getBinaryPath, getConfigDir } from './platform.js';
import { mkdirSync, chmodSync, existsSync, createWriteStream, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { log } from './logger.js';
import { homedir } from 'os';

const RELEASES_API = 'https://api.github.com/repos/MetaCubeX/mihomo/releases/latest';

async function getLatestRelease() {
  const res = await fetch(RELEASES_API);
  if (!res.ok) throw new Error(`Failed to fetch releases: ${res.status}`);
  return res.json();
}

function findAsset(release, os, arch) {
  const suffix = os === 'windows' ? '.zip' : '.gz';
  const pattern = `mihomo-${os}-${arch}`;
  const asset = release.assets.find(a =>
    a.name.includes(pattern) && a.name.endsWith(suffix) && !a.name.includes('compatible')
  );
  if (!asset) throw new Error(`No binary found for ${os}-${arch}`);
  return asset;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const { writeFileSync } = await import('fs');
  writeFileSync(dest, buffer);
}

export async function install() {
  const { mihomoOS, mihomoArch, os } = getPlatform();
  const binPath = getBinaryPath();
  const configDir = getConfigDir();

  log(`Detecting platform: ${mihomoOS}/${mihomoArch}`);

  // Fetch latest release
  log('Fetching latest mihomo release...');
  const release = await getLatestRelease();
  const version = release.tag_name;
  const asset = findAsset(release, mihomoOS, mihomoArch);

  log(`Downloading ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)}MB)...`);

  // Download
  const tmpFile = join('/tmp', asset.name);
  await download(asset.browser_download_url, tmpFile);

  // Extract
  mkdirSync(dirname(binPath), { recursive: true });
  if (tmpFile.endsWith('.gz')) {
    execSync(`gunzip -f "${tmpFile}"`, { stdio: 'pipe' });
    const extracted = tmpFile.replace('.gz', '');
    execSync(`mv "${extracted}" "${binPath}"`, { stdio: 'pipe' });
    chmodSync(binPath, 0o755);
  } else if (tmpFile.endsWith('.zip')) {
    execSync(`unzip -o "${tmpFile}" -d "${dirname(binPath)}"`, { stdio: 'pipe' });
    // Rename extracted binary
    const extracted = join(dirname(binPath), asset.name.replace('.zip', ''));
    if (existsSync(extracted)) execSync(`mv "${extracted}" "${binPath}"`, { stdio: 'pipe' });
  }

  // Create config dir
  mkdirSync(configDir, { recursive: true });

  // Install service (Linux only for now)
  let serviceInstalled = false;
  if (os === 'linux') {
    serviceInstalled = installSystemdService(binPath, configDir);
  } else if (os === 'darwin') {
    serviceInstalled = installLaunchdService(binPath, configDir);
  }

  // Verify
  try {
    const ver = execSync(`"${binPath}" -v`, { encoding: 'utf8' }).trim();
    log(`Installed: ${ver}`);
    return { installed: true, version: ver, path: binPath, configDir, service: serviceInstalled };
  } catch {
    return { installed: true, version, path: binPath, configDir, service: serviceInstalled };
  }
}

function installSystemdService(binPath, configDir) {
  try {
    const unit = `[Unit]
Description=mihomo Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${binPath} -d ${configDir}
Restart=on-failure
RestartSec=5
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
`;
    const servicePath = '/etc/systemd/system/mihomo.service';
    try {
      execSync(`echo '${unit}' | sudo tee ${servicePath}`, { stdio: 'pipe' });
      execSync('sudo systemctl daemon-reload', { stdio: 'pipe' });
      execSync('sudo systemctl enable mihomo', { stdio: 'pipe' });
      return true;
    } catch {
      // No sudo, try user service
      const userDir = join(homedir(), '.config', 'systemd', 'user');
      mkdirSync(userDir, { recursive: true });
      writeFileSync(join(userDir, 'mihomo.service'), unit);
      execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
      execSync('systemctl --user enable mihomo', { stdio: 'pipe' });
      return true;
    }
  } catch { return false; }
}

function installLaunchdService(binPath, configDir) {
  try {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.mihomo.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${binPath}</string>
        <string>-d</string>
        <string>${configDir}</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
</dict>
</plist>`;
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.mihomo.daemon.plist');
    writeFileSync(plistPath, plist);
    return true;
  } catch { return false; }
}
