import path from 'node:path'
import os from 'node:os'
import type { Context } from '@deepseek-ai/cordis'

/** Resolve the dsh home directory (~/.dsh by default). */
export function resolveHome(ctx: Context): string {
  try {
    const raw = (ctx as unknown as { dshHomePath?: unknown }).dshHomePath
    if (typeof raw === 'string' && raw) return raw
    if (typeof raw === 'function') {
      for (const arg of ['', '/']) {
        try {
          const v = raw(arg)
          if (typeof v === 'string' && v) return v
        } catch {
          // fall through
        }
      }
      try {
        const v = raw()
        if (typeof v === 'string' && v) return v
      } catch {
        // fall through
      }
    }
  } catch {
    // dshHomePath not injectable in this baseline; fall back to env/home
  }
  return process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
}

export function resolveDirs(ctx: Context, config: { dbPath?: string; skillDir?: string; flowDir?: string }) {
  const home = resolveHome(ctx)
  return {
    home,
    dbPath: config.dbPath || path.join(home, 'deepjit', 'deepjit.db'),
    skillDir: config.skillDir || path.join(home, 'deepjit', 'skills'),
    flowDir: config.flowDir || path.join(home, 'deepjit', 'flows'),
  }
}
