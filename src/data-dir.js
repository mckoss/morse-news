import path from 'node:path';

export function resolveDataDir(env = process.env) {
  return path.resolve(env.DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || 'data');
}
