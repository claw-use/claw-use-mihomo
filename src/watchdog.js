import { testEndpoints, switchNode, status } from './api.js';
import { log } from './logger.js';

export async function watch(config) {
  const { checkInterval, failThreshold, cooldown } = config.watchdog;
  let failCount = 0;
  let lastSwitch = 0;

  const current = await status(config).catch(() => ({ node: 'unknown' }));
  log(`Watchdog started: interval=${checkInterval}s threshold=${failThreshold} node=${current.node}`);

  while (true) {
    const result = await testEndpoints(config);

    if (result.ok) {
      if (failCount > 0) {
        log(`Recovered after ${failCount} failures`);
        console.log(JSON.stringify({ event: 'recovered', failCount }));
      }
      failCount = 0;
    } else {
      failCount++;
      const s = await status(config).catch(() => ({ node: 'unknown' }));
      log(`Fail #${failCount} on '${s.node}'`);
      console.log(JSON.stringify({ event: 'fail', count: failCount, node: s.node }));

      if (failCount >= failThreshold) {
        const now = Date.now() / 1000;
        if (now - lastSwitch >= cooldown) {
          lastSwitch = now;
          try {
            const result = await switchNode(config);
            log(`Switched: ${result.from} -> ${result.to}`);
            console.log(JSON.stringify({ event: 'switch', ...result }));
          } catch (e) {
            log(`Switch failed: ${e.message}`);
            console.log(JSON.stringify({ event: 'switch_failed', error: e.message }));
          }
        } else {
          log(`Cooldown active, skipping switch`);
        }
        failCount = 0;
      }
    }

    await new Promise(r => setTimeout(r, checkInterval * 1000));
  }
}
