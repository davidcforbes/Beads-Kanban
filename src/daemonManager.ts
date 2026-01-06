import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Get the status of the daemon for this workspace
   */
  async getStatus(): Promise<DaemonStatus> {
    try {
      // Run: bd info | grep daemon
      const { stdout } = await execAsync('bd info', { cwd: this.workspaceRoot });

      // Parse daemon info from output
      const lines = stdout.split('\n');
      const daemonLine = lines.find(line => line.toLowerCase().includes('daemon'));

      if (!daemonLine) {
        return { running: false, healthy: false };
      }

      // Check if daemon is running
      const running = daemonLine.toLowerCase().includes('running') ||
                     daemonLine.toLowerCase().includes('enabled');

      // Extract PID if present (format: "daemon: running (pid 12345)")
      const pidMatch = daemonLine.match(/pid[:\s]+(\d+)/i);
      const pid = pidMatch ? parseInt(pidMatch[1]) : undefined;

      return {
        running,
        pid,
        healthy: running,
        workspace: this.workspaceRoot
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
      const { stdout } = await execAsync('bd daemons list --json', { cwd: this.workspaceRoot });

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
      const { stdout } = await execAsync('bd daemons health --json', { cwd: this.workspaceRoot });

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
    await execAsync('bd daemons restart .', { cwd: this.workspaceRoot });
  }

  /**
   * Stop the daemon for this workspace
   */
  async stop(): Promise<void> {
    await execAsync('bd daemons stop .', { cwd: this.workspaceRoot });
  }

  /**
   * Get daemon logs
   */
  async getLogs(lines: number = 50): Promise<string> {
    try {
      // Validate lines parameter to prevent command injection
      const safeLines = Math.max(1, Math.min(1000, Math.floor(lines)));
      const { stdout } = await execAsync(`bd daemons logs . -n ${safeLines}`, { cwd: this.workspaceRoot });
      return stdout;
    } catch (error) {
      return error instanceof Error ? error.message : 'Failed to get logs';
    }
  }
}
