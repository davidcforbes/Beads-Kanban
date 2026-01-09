/**
 * Sanitizes error messages by removing file paths and sensitive information.
 * Consolidates path removal logic to prevent information leakage in error messages.
 */
export function sanitizeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);

  // Comprehensive path removal patterns:
  // 1. Windows absolute paths (C:\..., D:\...)
  // 2. UNC paths (\\server\share...)
  // 3. Unix absolute paths starting with common root directories
  // 4. Any path with common file extensions (fallback)
  const sanitized = msg
    // Windows absolute paths: C:\... or C:/...
    .replace(/[A-Za-z]:[\\/][^\s]*/g, '[PATH]')
    // UNC paths: \\server\share...
    .replace(/\\\\[^\s]+/g, '[PATH]')
    // Unix absolute paths starting with common root directories
    .replace(/\/(?:usr|home|opt|var|tmp|etc|lib|bin|sbin|mnt|srv|root|proc|sys|dev|Applications|Users|Library)(?:\/[^\s]*)?/g, '[PATH]')
    // Fallback: catch any remaining paths with common file extensions
    .replace(/(?:\/|\\)[^\s]*\.(ts|js|tsx|jsx|db|sqlite|sqlite3|json|log|txt)/g, '[FILE]')
    // Remove stack trace lines
    .replace(/\s+at\s+.*/g, '');

  // Return cleaned message
  return sanitized.trim() || 'An error occurred while processing your request.';
}

/**
 * Sanitizes error messages with user-friendly messages for common cases.
 * Use this in the extension where providing helpful context is important.
 * Provides actionable guidance to help users resolve issues.
 */
export function sanitizeErrorWithContext(error: unknown): string {
  const sanitized = sanitizeError(error);

  // Provide specific, actionable error messages for common cases

  // File system errors
  if (sanitized.includes('ENOENT')) {
    return 'Database file not found. Click the Refresh button or check that the .beads directory exists in your workspace.';
  }
  if (sanitized.includes('EACCES') || sanitized.includes('EPERM')) {
    return 'Permission denied accessing database file. Check file permissions in the .beads directory.';
  }

  // Database errors
  if (sanitized.includes('SQLITE_BUSY')) {
    return 'Database is locked by another process. Close other applications accessing the database and try again.';
  }
  if (sanitized.includes('SQLITE_CORRUPT')) {
    return 'Database file is corrupted. You may need to restore from backup or reinitialize with "bd init".';
  }
  if (sanitized.includes('SQLITE_CANTOPEN')) {
    return 'Cannot open database file. Ensure the .beads directory exists and has proper permissions.';
  }
  if (sanitized.includes('not connected') || sanitized.includes('Database not connected')) {
    return 'Database connection lost. Click the Refresh button to reconnect.';
  }

  // Network/timeout errors
  if (sanitized.includes('timeout') || sanitized.includes('ETIMEDOUT')) {
    return 'Operation timed out. The request is taking longer than expected. Check your daemon status or try again.';
  }
  if (sanitized.includes('ECONNREFUSED') || sanitized.includes('connection refused')) {
    return 'Connection refused. Ensure the bd daemon is running (check status bar).';
  }

  // Daemon-specific errors
  if (sanitized.includes('daemon not running') || sanitized.includes('Daemon not running')) {
    return 'Beads daemon is not running. Click the status bar to start the daemon, or run "bd daemon start" in terminal.';
  }
  if (sanitized.includes('bd command not found') || sanitized.includes('bd: command not found')) {
    return 'Beads CLI (bd) not found in PATH. Install beads or add it to your system PATH.';
  }

  // Validation errors (keep as-is, they're already user-friendly)
  if (sanitized.includes('Invalid') || sanitized.includes('validation') || sanitized.includes('required')) {
    return sanitized;
  }

  // Parsing errors
  if (sanitized.includes('JSON') || sanitized.includes('parse')) {
    return 'Invalid data format received. This may indicate a version mismatch. Try refreshing the board.';
  }

  // Return generic message only if truly empty or unrecognizable
  if (sanitized.length === 0) {
    return 'An unexpected error occurred. Check the Output panel (View > Output > Beads Kanban) for details.';
  }

  // Return sanitized message with helpful suffix for unrecognized errors
  return `${sanitized}. If this persists, check the Output panel (View > Output > Beads Kanban) for details.`;
}
