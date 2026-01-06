import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Execute a command using spawn (more secure than exec)
 * @param command Command to execute
 * @param args Command arguments
 * @param cwd Working directory
 * @returns Promise resolving to stdout
 */
function spawnAsync(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with exit code ${code}: ${stderr || stdout}`));
      }
    });
  });
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  version?: string;
  workspace?: string;
  healthy: boolean;
  error?: string;
}

export interface DaemonInfo {
  workspace: string;
  pid: number;
  version: string;
  socket: string;
  uptime?: string;
}

export class DaemonManager {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    // Validate and normalize workspace path to prevent command injection
    if (!workspaceRoot || typeof workspaceRoot !== 'string') {
      throw new Error('Invalid workspace root: must be a non-empty string');
    }
    
    // Normalize the path to resolve any relative paths or path traversal attempts
    const normalized = path.resolve(workspaceRoot);
    
    // Validate that the path exists and is a directory
    try {
      const stats = fs.statSync(normalized);
      if (!stats.isDirectory()) {
        throw new Error(`Invalid workspace root: ${normalized} is not a directory`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Invalid workspace root: ${normalized} does not exist`);
      }
      throw error;
    }
    
    // Additional check: ensure path doesn't contain dangerous characters
    // While cwd is relatively safe, this prevents edge cases
    if (/[;&|`$()]/.test(normalized)) {
      throw new Error('Invalid workspace root: path contains potentially dangerous characters');
    }
    
    this.workspaceRoot = normalized;
  }

  /**
   * Get the status of the daemon for this workspace
   */
  async getStatus(): Promise<DaemonStatus> {
    try {
      const { stdout } = await spawnAsync('bd', ['info', '--json'], this.workspaceRoot);
      if (!stdout.trim()) {
        return { running: false, healthy: false };
      }

      const info = JSON.parse(stdout);
      const running = Boolean(info.daemon_connected);
      const healthy = running && info.daemon_status === 'healthy';

      return {
        running,
        healthy,
        workspace: this.workspaceRoot,
        version: info.daemon_version
      };
    } catch (error) {
      return {
        running: false,
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * List all running daemons across workspaces
   */
  async listAllDaemons(): Promise<DaemonInfo[]> {
    try {
      const { stdout } = await spawnAsync('bd', ['daemons', 'list', '--json'], this.workspaceRoot);

      if (!stdout.trim()) {
        return [];
      }

      const result = JSON.parse(stdout);

      // Handle different response formats
      if (Array.isArray(result)) {
        return result;
      } else if (result.daemons && Array.isArray(result.daemons)) {
        return result.daemons;
      }

      return [];
    } catch (error) {
      console.error('Failed to list daemons:', error);
      return [];
    }
  }

  /**
   * Check daemon health
   */
  async checkHealth(): Promise<{ healthy: boolean; issues: string[] }> {
    try {
      const { stdout } = await spawnAsync('bd', ['daemons', 'health', '--json'], this.workspaceRoot);

      if (!stdout.trim()) {
        return { healthy: true, issues: [] };
      }

      const result = JSON.parse(stdout);

      const issues: string[] = [];
      if (result.dead_processes && result.dead_processes.length > 0) {
        issues.push(`${result.dead_processes.length} dead process(es) with remaining sockets`);
      }
      if (result.version_mismatches && result.version_mismatches.length > 0) {
        issues.push(`${result.version_mismatches.length} version mismatch(es)`);
      }
      if (result.unresponsive && result.unresponsive.length > 0) {
        issues.push(`${result.unresponsive.length} unresponsive daemon(s)`);
      }

      return {
        healthy: issues.length === 0,
        issues
      };
    } catch (error) {
      return {
        healthy: false,
        issues: [error instanceof Error ? error.message : 'Health check failed']
      };
    }
  }

  /**
   * Restart the daemon for this workspace
   */
  async restart(): Promise<void> {
    await spawnAsync('bd', ['daemons', 'restart', '.'], this.workspaceRoot);
  }

  /**
   * Stop the daemon for this workspace
   */
  async stop(): Promise<void> {
    await spawnAsync('bd', ['daemons', 'stop', '.'], this.workspaceRoot);
  }

  /**
   * Get daemon logs
   */
  async getLogs(lines: number = 50): Promise<string> {
    try {
      // Validate lines parameter
      const safeLines = Math.max(1, Math.min(1000, Math.floor(lines)));
      const { stdout } = await spawnAsync('bd', ['daemons', 'logs', '.', '-n', String(safeLines)], this.workspaceRoot);
      return stdout;
    } catch (error) {
      return error instanceof Error ? error.message : 'Failed to get logs';
    }
  }
}
