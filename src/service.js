import { execSync, spawn } from 'child_process';
import { platform } from 'os';
import { existsSync } from 'fs';
import { getBinaryPath, getConfigDir } from './platform.js';
import { log } from './logger.js';

export async function startMihomo(config) {
  const os = platform();
  const binPath = config?.mihomo?.binaryPath || getBinaryPath();
  const configDir = config?.mihomo?.configPath ? config.mihomo.configPath.replace(/\/[^/]+$/, '') : getConfigDir();

  if (!existsSync(binPath)) {
    throw new Error(`mihomo not found at ${binPath}. Run 'mihomod install' first.`);
  }

  if (os === 'linux') {
    try {
      execSync('systemctl is-active mihomo', { stdio: 'pipe' });
      return { started: true, method: 'systemd', note: 'already running' };
    } catch {}
    try {
      execSync('sudo systemctl start mihomo', { stdio: 'pipe' });
      return { started: true, method: 'systemd' };
    } catch {
      try {
        execSync('systemctl --user start mihomo', { stdio: 'pipe' });
        return { started: true, method: 'systemd-user' };
      } catch {}
    }
  }

  if (os === 'darwin') {
    try {
      execSync('launchctl load ~/Library/LaunchAgents/com.mihomo.daemon.plist', { stdio: 'pipe' });
      return { started: true, method: 'launchd' };
    } catch {}
  }

  // Fallback: direct execution
  const child = spawn(binPath, ['-d', configDir], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  return { started: true, method: 'direct', pid: child.pid };
}

export async function stopMihomo(config) {
  const os = platform();

  if (os === 'linux') {
    try {
      execSync('sudo systemctl stop mihomo', { stdio: 'pipe' });
      return { stopped: true, method: 'systemd' };
    } catch {
      try {
        execSync('systemctl --user stop mihomo', { stdio: 'pipe' });
        return { stopped: true, method: 'systemd-user' };
      } catch {}
    }
  }

  if (os === 'darwin') {
    try {
      execSync('launchctl unload ~/Library/LaunchAgents/com.mihomo.daemon.plist', { stdio: 'pipe' });
      return { stopped: true, method: 'launchd' };
    } catch {}
  }

  // Fallback: kill process
  try {
    execSync('pkill -f mihomo', { stdio: 'pipe' });
    return { stopped: true, method: 'pkill' };
  } catch {
    return { stopped: false, error: 'Could not stop mihomo' };
  }
}
