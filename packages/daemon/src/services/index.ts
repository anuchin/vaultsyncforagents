/**
 * Platform dispatch for service management (FR-43): systemd on Linux,
 * launchd on macOS, a clear refusal everywhere else (Windows in v1).
 * `selectServiceBackend` throws for unsupported platforms — callers that
 * must not crash (status/logs UIs) use `serviceStatusFor`/`logsFor` which
 * return the refusal as data.
 */

import {
  isServicePlatform,
  SERVICE_UNSUPPORTED_MESSAGE,
  ServiceError,
  type ServiceBackend,
  type ServiceStatus,
} from './service.js';
import { LaunchdService, type LaunchdServiceOptions } from './launchd.js';
import { SystemdService, type SystemdServiceOptions } from './systemd.js';

export type ServiceKind = 'systemd' | 'launchd' | 'unsupported';

export type ServiceOptions = SystemdServiceOptions & LaunchdServiceOptions;

/** Which backend this platform uses; `'unsupported'` for win32/unknown. */
export function serviceKindFor(platform: string = process.platform): ServiceKind {
  if (platform === 'linux') return 'systemd';
  if (platform === 'darwin') return 'launchd';
  return 'unsupported';
}

/** The service backend for this platform; throws the FR-43 refusal otherwise. */
export function selectServiceBackend(options: ServiceOptions = {}): ServiceBackend {
  const platform = options.platform ?? process.platform;
  if (!isServicePlatform(platform)) {
    throw new ServiceError(SERVICE_UNSUPPORTED_MESSAGE);
  }
  return serviceKindFor(platform) === 'systemd'
    ? new SystemdService(options)
    : new LaunchdService(options);
}

/** `status()` that never throws: unsupported platforms become data. */
export async function serviceStatusFor(options: ServiceOptions = {}): Promise<ServiceStatus> {
  const platform = options.platform ?? process.platform;
  if (!isServicePlatform(platform)) {
    return {
      backend: 'none',
      installed: false,
      active: null,
      detail: SERVICE_UNSUPPORTED_MESSAGE,
    };
  }
  return selectServiceBackend(options).status();
}

/** `logs()` that never throws: unsupported platforms get the foreground hint. */
export async function serviceLogsFor(
  options: ServiceOptions = {},
  tailLines = 100,
): Promise<string> {
  const platform = options.platform ?? process.platform;
  if (!isServicePlatform(platform)) {
    return (
      `${SERVICE_UNSUPPORTED_MESSAGE}\n` +
      'Run the daemon in the foreground (`vsa daemon run`) to see its structured logs directly.'
    );
  }
  return selectServiceBackend(options).logs(tailLines);
}

export * from './service.js';
export * from './systemd.js';
export * from './launchd.js';
