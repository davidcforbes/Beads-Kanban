"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeError = sanitizeError;
exports.sanitizeErrorWithContext = sanitizeErrorWithContext;
/**
 * Sanitizes error messages by removing file paths and sensitive information.
 * Consolidates path removal logic to prevent information leakage in error messages.
 */
function sanitizeError(error) {
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
 */
function sanitizeErrorWithContext(error) {
    const sanitized = sanitizeError(error);
    // Provide specific error messages for common cases
    if (sanitized.includes('ENOENT')) {
        return 'Database file not found. Please ensure .beads directory exists.';
    }
    if (sanitized.includes('EACCES')) {
        return 'Permission denied accessing database file.';
    }
    if (sanitized.includes('SQLITE_BUSY')) {
        return 'Database is busy. Please try again.';
    }
    if (sanitized.includes('not connected') || sanitized.includes('Database not connected')) {
        return 'Database connection lost. Please refresh the board.';
    }
    if (sanitized.includes('Invalid') || sanitized.includes('validation')) {
        return sanitized; // Keep validation errors as they're user-friendly
    }
    // Return generic message only if truly empty or unrecognizable
    if (sanitized.length === 0) {
        return 'An error occurred while processing your request.';
    }
    return sanitized;
}
