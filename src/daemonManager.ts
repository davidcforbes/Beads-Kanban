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
  private logger?: { appendLine: (value: string) => void };

  constructor(workspaceRoot: string, logger?: { appendLine: (value: string) => void }) {
    // Validate and normalize workspace path to prevent command injection
    if (!workspaceRoot || typeof workspaceRoot !== 'string') {
      throw new Error('Invalid workspace root: must be a non-empty string');
    }

    // Prevent path traversal BEFORE normalization (path.resolve removes '..' making checks ineffective)
    // This catches attempts like '../../../etc/passwd' before normalization
    if (workspaceRoot.includes('..')) {
      throw new Error('Invalid workspace root: path traversal sequences not allowed');
    }

    // Normalize the path to resolve any relative paths
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

    // Additional security checks: ensure path doesn't contain dangerous characters
    // Note: We use shell:false for all spawns, so shell metacharacters (like parentheses)
    // are safe and common in legitimate paths like "Program Files (x86)"

    // Block control characters (including null bytes and newlines) that could enable injection
    if (/[\0-\x1F\x7F]/.test(normalized)) {
      throw new Error('Invalid workspace root: path contains control characters');
    }

    this.workspaceRoot = normalized;
    this.logger = logger;
  }

  private logSpawnError(args: string[], error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const command = `bd ${args.join(' ')}`;
    const logLine = `[DaemonManager] ${command} failed: ${message}`;

    if (this.logger) {
      this.logger.appendLine(logLine);
      this.logger.appendLine(`[DaemonManager] CWD: ${this.workspaceRoot}`);
      this.logger.appendLine(`[DaemonManager] PATH: ${process.env.PATH ?? ''}`);
      this.logger.appendLine(`[DaemonManager] PATHEXT: ${process.env.PATHEXT ?? ''}`);
    } else {
      console.error(logLine);
    }
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
      this.logSpawnError(['info', '--json'], error);
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
      const { stdout } = await spawnAsync('bd', ['daemon', 'list', '--json'], this.workspaceRoot);

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
      this.logSpawnError(['daemon', 'list', '--json'], error);
      return [];
    }
  }

  /**
   * Check daemon health
   */
  async checkHealth(): Promise<{ healthy: boolean; issues: string[] }> {
    try {
      const { stdout } = await spawnAsync('bd', ['daemon', 'health', '--json'], this.workspaceRoot);

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
      this.logSpawnError(['daemon', 'health', '--json'], error);
      return {
        healthy: false,
        issues: [error instanceof Error ? error.message : 'Health check failed']
      };
    }
  }

  /**
   * Restart the daemon for this workspace
   */
  /**
   * Start the daemon for this workspace
   */
  async start(): Promise<void> {
    try {
      await spawnAsync('bd', ['daemon', 'start'], this.workspaceRoot);
    } catch (error) {
      this.logSpawnError(['daemon', 'start'], error);
      throw error;
    }
  }

  async restart(): Promise<void> {
    try {
      await spawnAsync('bd', ['daemon', 'restart', this.workspaceRoot], this.workspaceRoot);
    } catch (error) {
      this.logSpawnError(['daemon', 'restart', this.workspaceRoot], error);
      throw error;
    }
  }

  /**
   * Stop the daemon for this workspace
   */
  async stop(): Promise<void> {
    try {
      await spawnAsync('bd', ['daemon', 'stop', this.workspaceRoot], this.workspaceRoot);
    } catch (error) {
      this.logSpawnError(['daemon', 'stop', this.workspaceRoot], error);
      throw error;
    }
  }

  /**
   * Get daemon logs
   */
  async getLogs(lines: number = 50): Promise<string> {
    try {
      // Validate lines parameter
      const safeLines = Math.max(1, Math.min(1000, Math.floor(lines)));
      const { stdout } = await spawnAsync('bd', ['daemon', 'logs', this.workspaceRoot, '-n', String(safeLines)], this.workspaceRoot);
      return stdout;
    } catch (error) {
      this.logSpawnError(['daemon', 'logs', this.workspaceRoot, '-n', String(lines)], error);
      return error instanceof Error ? error.message : 'Failed to get logs';
    }
  }
}
