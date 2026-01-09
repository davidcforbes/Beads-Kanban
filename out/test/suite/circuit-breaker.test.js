"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const daemonBeadsAdapter_1 = require("../../daemonBeadsAdapter");
const sinon = __importStar(require("sinon"));
// Helper to access private members for testing
function getPrivate(obj, prop) {
    return obj[prop];
}
function setPrivate(obj, prop, value) {
    obj[prop] = value;
}
function callPrivate(obj, method, ...args) {
    return obj[method](...args);
}
suite('Circuit Breaker Tests', () => {
    let adapter;
    let output;
    let execStub;
    setup(function () {
        this.timeout(10000);
        output = vscode.window.createOutputChannel('Test Circuit Breaker');
        // DaemonBeadsAdapter requires workspaceRoot and OutputChannel
        const workspaceRoot = path.join(__dirname, '../../../');
        adapter = new daemonBeadsAdapter_1.DaemonBeadsAdapter(workspaceRoot, output);
        // Stub execBd to simulate failures/successes
        execStub = sinon.stub(adapter, 'execBd');
    });
    teardown(function () {
        if (adapter) {
            adapter.dispose();
        }
        if (output) {
            output.dispose();
        }
        sinon.restore();
    });
    suite('State Transitions', () => {
        test('CLOSED → OPEN after threshold failures', function () {
            // Initial state should be CLOSED
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'CLOSED');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), 0);
            // Record failures below threshold
            const threshold = getPrivate(adapter, 'CIRCUIT_FAILURE_THRESHOLD');
            for (let i = 0; i < threshold - 1; i++) {
                callPrivate(adapter, 'recordCircuitFailure');
                assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'CLOSED', `Should stay CLOSED after ${i + 1} failures`);
                assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), i + 1);
            }
            // Record one more failure to hit threshold
            callPrivate(adapter, 'recordCircuitFailure');
            // Should now be OPEN
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'OPEN', 'Should transition to OPEN after threshold failures');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), threshold);
            assert.ok(getPrivate(adapter, 'circuitOpenedAt') > 0, 'Should record when circuit opened');
        });
        test('OPEN → HALF_OPEN after timeout', function (done) {
            this.timeout(70000); // Need more than 60s for timeout
            // Manually set circuit to OPEN
            setPrivate(adapter, 'circuitBreakerState', 'OPEN');
            setPrivate(adapter, 'circuitOpenedAt', Date.now());
            // Circuit should be open immediately
            assert.strictEqual(callPrivate(adapter, 'isCircuitOpen'), true, 'Circuit should be open immediately');
            // Fast-forward time by manipulating circuitOpenedAt
            const timeout = getPrivate(adapter, 'CIRCUIT_RESET_TIMEOUT_MS');
            setPrivate(adapter, 'circuitOpenedAt', Date.now() - timeout - 1000);
            // Check circuit - should transition to HALF_OPEN
            const isOpen = callPrivate(adapter, 'isCircuitOpen');
            assert.strictEqual(isOpen, false, 'Circuit should allow requests after timeout');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'HALF_OPEN', 'Should transition to HALF_OPEN after timeout');
            done();
        });
        test('HALF_OPEN → CLOSED on success', function () {
            // Set circuit to HALF_OPEN
            setPrivate(adapter, 'circuitBreakerState', 'HALF_OPEN');
            setPrivate(adapter, 'consecutiveFailures', 3);
            // Record success
            callPrivate(adapter, 'recordCircuitSuccess');
            // Should transition to CLOSED and reset failures
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'CLOSED', 'Should transition to CLOSED on success in HALF_OPEN');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), 0, 'Should reset failure counter');
        });
        test('HALF_OPEN → OPEN on failure', function () {
            // Set circuit to HALF_OPEN
            setPrivate(adapter, 'circuitBreakerState', 'HALF_OPEN');
            setPrivate(adapter, 'consecutiveFailures', 5);
            const beforeOpenedAt = Date.now();
            // Record failure
            callPrivate(adapter, 'recordCircuitFailure');
            // Should reopen circuit
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'OPEN', 'Should reopen circuit on failure in HALF_OPEN');
            assert.ok(getPrivate(adapter, 'circuitOpenedAt') >= beforeOpenedAt, 'Should update circuitOpenedAt timestamp');
        });
        test('CLOSED → CLOSED on success (no change)', function () {
            // Start in CLOSED state
            setPrivate(adapter, 'circuitBreakerState', 'CLOSED');
            setPrivate(adapter, 'consecutiveFailures', 2);
            // Record success
            callPrivate(adapter, 'recordCircuitSuccess');
            // Should stay CLOSED and reset failures
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'CLOSED', 'Should stay CLOSED on success');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), 0, 'Should reset failure counter');
        });
    });
    suite('Failure Threshold Counting', () => {
        test('Failure counter increments on each failure', function () {
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), 0);
            callPrivate(adapter, 'recordCircuitFailure');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), 1);
            callPrivate(adapter, 'recordCircuitFailure');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), 2);
            callPrivate(adapter, 'recordCircuitFailure');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), 3);
        });
        test('Failure counter resets on success', function () {
            setPrivate(adapter, 'consecutiveFailures', 4);
            callPrivate(adapter, 'recordCircuitSuccess');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), 0, 'Should reset failure counter on success');
        });
        test('Circuit opens at exactly threshold failures', function () {
            const threshold = getPrivate(adapter, 'CIRCUIT_FAILURE_THRESHOLD');
            // Record threshold - 1 failures
            for (let i = 0; i < threshold - 1; i++) {
                callPrivate(adapter, 'recordCircuitFailure');
            }
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'CLOSED', 'Should not open before threshold');
            // Record one more to hit threshold
            callPrivate(adapter, 'recordCircuitFailure');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'OPEN', 'Should open at threshold');
        });
        test('Circuit does not open below threshold', function () {
            const threshold = getPrivate(adapter, 'CIRCUIT_FAILURE_THRESHOLD');
            // Record threshold - 2 failures
            for (let i = 0; i < threshold - 2; i++) {
                callPrivate(adapter, 'recordCircuitFailure');
            }
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'CLOSED', 'Should stay closed below threshold');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), threshold - 2);
        });
    });
    suite('Timeout and Reset Behavior', () => {
        test('Circuit stays OPEN before timeout', function () {
            setPrivate(adapter, 'circuitBreakerState', 'OPEN');
            setPrivate(adapter, 'circuitOpenedAt', Date.now());
            // Check immediately - should still be open
            assert.strictEqual(callPrivate(adapter, 'isCircuitOpen'), true, 'Should be open immediately after opening');
            // Check after 30 seconds (half the timeout) - should still be open
            const timeout = getPrivate(adapter, 'CIRCUIT_RESET_TIMEOUT_MS');
            setPrivate(adapter, 'circuitOpenedAt', Date.now() - (timeout / 2));
            assert.strictEqual(callPrivate(adapter, 'isCircuitOpen'), true, 'Should still be open halfway through timeout');
        });
        test('Circuit auto-transitions to HALF_OPEN after timeout', function () {
            const timeout = getPrivate(adapter, 'CIRCUIT_RESET_TIMEOUT_MS');
            setPrivate(adapter, 'circuitBreakerState', 'OPEN');
            setPrivate(adapter, 'circuitOpenedAt', Date.now() - timeout - 1000);
            // isCircuitOpen() should trigger the transition
            const isOpen = callPrivate(adapter, 'isCircuitOpen');
            assert.strictEqual(isOpen, false, 'Should allow requests after timeout');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'HALF_OPEN', 'Should be in HALF_OPEN state after timeout');
        });
        test('HALF_OPEN state allows requests through', function () {
            setPrivate(adapter, 'circuitBreakerState', 'HALF_OPEN');
            const isOpen = callPrivate(adapter, 'isCircuitOpen');
            assert.strictEqual(isOpen, false, 'HALF_OPEN should allow requests through');
        });
        test('CLOSED state allows requests through', function () {
            setPrivate(adapter, 'circuitBreakerState', 'CLOSED');
            const isOpen = callPrivate(adapter, 'isCircuitOpen');
            assert.strictEqual(isOpen, false, 'CLOSED should allow requests through');
        });
    });
    suite('Error Handling in Each State', () => {
        test('Error in CLOSED state increments counter', function () {
            setPrivate(adapter, 'circuitBreakerState', 'CLOSED');
            const initialFailures = getPrivate(adapter, 'consecutiveFailures');
            callPrivate(adapter, 'recordCircuitFailure');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), initialFailures + 1, 'Should increment failure counter');
            // Should still be CLOSED if below threshold
            const threshold = getPrivate(adapter, 'CIRCUIT_FAILURE_THRESHOLD');
            if (getPrivate(adapter, 'consecutiveFailures') < threshold) {
                assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'CLOSED');
            }
        });
        test('Error in OPEN state blocks requests', function () {
            setPrivate(adapter, 'circuitBreakerState', 'OPEN');
            setPrivate(adapter, 'circuitOpenedAt', Date.now());
            const isOpen = callPrivate(adapter, 'isCircuitOpen');
            assert.strictEqual(isOpen, true, 'OPEN state should block requests');
        });
        test('Error in HALF_OPEN state reopens circuit', function () {
            setPrivate(adapter, 'circuitBreakerState', 'HALF_OPEN');
            setPrivate(adapter, 'consecutiveFailures', 5);
            callPrivate(adapter, 'recordCircuitFailure');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'OPEN', 'Should reopen circuit on error in HALF_OPEN');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), 6, 'Should increment failure counter');
        });
        test('Success in CLOSED state has no side effects', function () {
            setPrivate(adapter, 'circuitBreakerState', 'CLOSED');
            setPrivate(adapter, 'consecutiveFailures', 0);
            callPrivate(adapter, 'recordCircuitSuccess');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'CLOSED', 'Should stay CLOSED');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), 0, 'Counter should stay at 0');
        });
        test('Success in HALF_OPEN state closes circuit', function () {
            setPrivate(adapter, 'circuitBreakerState', 'HALF_OPEN');
            setPrivate(adapter, 'consecutiveFailures', 5);
            callPrivate(adapter, 'recordCircuitSuccess');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'CLOSED', 'Should close circuit');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), 0, 'Should reset failure counter');
        });
    });
    suite('Integration Tests - Simulated Failures', () => {
        test('Multiple operations with intermittent failures', function () {
            // Start in CLOSED
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'CLOSED');
            // Simulate 3 failures
            callPrivate(adapter, 'recordCircuitFailure');
            callPrivate(adapter, 'recordCircuitFailure');
            callPrivate(adapter, 'recordCircuitFailure');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'CLOSED', 'Should stay CLOSED after 3 failures');
            // Success resets counter
            callPrivate(adapter, 'recordCircuitSuccess');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), 0, 'Success should reset counter');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'CLOSED');
            // Now hit threshold with 5 consecutive failures
            const threshold = getPrivate(adapter, 'CIRCUIT_FAILURE_THRESHOLD');
            for (let i = 0; i < threshold; i++) {
                callPrivate(adapter, 'recordCircuitFailure');
            }
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'OPEN', 'Should open after threshold failures');
        });
        test('Full recovery cycle: CLOSED → OPEN → HALF_OPEN → CLOSED', function () {
            // Start CLOSED
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'CLOSED');
            // Transition to OPEN
            const threshold = getPrivate(adapter, 'CIRCUIT_FAILURE_THRESHOLD');
            for (let i = 0; i < threshold; i++) {
                callPrivate(adapter, 'recordCircuitFailure');
            }
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'OPEN');
            // Simulate timeout to transition to HALF_OPEN
            const timeout = getPrivate(adapter, 'CIRCUIT_RESET_TIMEOUT_MS');
            setPrivate(adapter, 'circuitOpenedAt', Date.now() - timeout - 1000);
            callPrivate(adapter, 'isCircuitOpen'); // Triggers transition
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'HALF_OPEN');
            // Success in HALF_OPEN closes circuit
            callPrivate(adapter, 'recordCircuitSuccess');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'CLOSED');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), 0);
        });
        test('Failed recovery: OPEN → HALF_OPEN → OPEN', function () {
            // Start CLOSED, transition to OPEN
            const threshold = getPrivate(adapter, 'CIRCUIT_FAILURE_THRESHOLD');
            for (let i = 0; i < threshold; i++) {
                callPrivate(adapter, 'recordCircuitFailure');
            }
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'OPEN');
            // Transition to HALF_OPEN via timeout
            const timeout = getPrivate(adapter, 'CIRCUIT_RESET_TIMEOUT_MS');
            setPrivate(adapter, 'circuitOpenedAt', Date.now() - timeout - 1000);
            callPrivate(adapter, 'isCircuitOpen');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'HALF_OPEN');
            // Failure in HALF_OPEN reopens circuit
            const beforeOpenedAt = getPrivate(adapter, 'circuitOpenedAt');
            callPrivate(adapter, 'recordCircuitFailure');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'OPEN');
            assert.ok(getPrivate(adapter, 'circuitOpenedAt') > beforeOpenedAt, 'Should update circuitOpenedAt');
        });
        test('Multiple recovery attempts', function () {
            // Open the circuit
            const threshold = getPrivate(adapter, 'CIRCUIT_FAILURE_THRESHOLD');
            for (let i = 0; i < threshold; i++) {
                callPrivate(adapter, 'recordCircuitFailure');
            }
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'OPEN');
            // First recovery attempt fails
            const timeout = getPrivate(adapter, 'CIRCUIT_RESET_TIMEOUT_MS');
            setPrivate(adapter, 'circuitOpenedAt', Date.now() - timeout - 1000);
            callPrivate(adapter, 'isCircuitOpen');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'HALF_OPEN');
            callPrivate(adapter, 'recordCircuitFailure');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'OPEN');
            // Second recovery attempt succeeds
            setPrivate(adapter, 'circuitOpenedAt', Date.now() - timeout - 1000);
            callPrivate(adapter, 'isCircuitOpen');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'HALF_OPEN');
            callPrivate(adapter, 'recordCircuitSuccess');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'CLOSED');
        });
    });
    suite('Edge Cases', () => {
        test('Success resets counter even with high failure count', function () {
            setPrivate(adapter, 'consecutiveFailures', 100);
            callPrivate(adapter, 'recordCircuitSuccess');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), 0, 'Should reset to 0 regardless of count');
        });
        test('Transition to HALF_OPEN only happens once', function () {
            const timeout = getPrivate(adapter, 'CIRCUIT_RESET_TIMEOUT_MS');
            setPrivate(adapter, 'circuitBreakerState', 'OPEN');
            setPrivate(adapter, 'circuitOpenedAt', Date.now() - timeout - 1000);
            // First check transitions to HALF_OPEN
            callPrivate(adapter, 'isCircuitOpen');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'HALF_OPEN');
            // Second check should not change state
            callPrivate(adapter, 'isCircuitOpen');
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'HALF_OPEN', 'Should stay HALF_OPEN');
        });
        test('Circuit opened timestamp is set correctly', function () {
            const beforeTime = Date.now();
            const threshold = getPrivate(adapter, 'CIRCUIT_FAILURE_THRESHOLD');
            for (let i = 0; i < threshold; i++) {
                callPrivate(adapter, 'recordCircuitFailure');
            }
            const afterTime = Date.now();
            const openedAt = getPrivate(adapter, 'circuitOpenedAt');
            assert.ok(openedAt >= beforeTime, 'circuitOpenedAt should be >= before time');
            assert.ok(openedAt <= afterTime, 'circuitOpenedAt should be <= after time');
        });
        test('Zero failures allowed before opening', function () {
            const threshold = getPrivate(adapter, 'CIRCUIT_FAILURE_THRESHOLD');
            // CIRCUIT_FAILURE_THRESHOLD should be > 0
            assert.ok(threshold > 0, 'Threshold should be positive');
            // Record threshold failures exactly
            for (let i = 0; i < threshold; i++) {
                callPrivate(adapter, 'recordCircuitFailure');
            }
            assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'OPEN', 'Should open at threshold');
        });
        test('Timeout value is reasonable', function () {
            const timeout = getPrivate(adapter, 'CIRCUIT_RESET_TIMEOUT_MS');
            // CIRCUIT_RESET_TIMEOUT_MS should be 60000 (1 minute)
            assert.strictEqual(timeout, 60000, 'Timeout should be 60 seconds');
        });
        test('Failure threshold is reasonable', function () {
            const threshold = getPrivate(adapter, 'CIRCUIT_FAILURE_THRESHOLD');
            // CIRCUIT_FAILURE_THRESHOLD should be 5
            assert.strictEqual(threshold, 5, 'Threshold should be 5 failures');
        });
    });
    suite('State Consistency', () => {
        test('Counter never goes negative', function () {
            setPrivate(adapter, 'consecutiveFailures', 0);
            // Try to reset when already at 0
            callPrivate(adapter, 'recordCircuitSuccess');
            assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), 0, 'Counter should not go negative');
        });
        test('State transitions are deterministic', function () {
            const threshold = getPrivate(adapter, 'CIRCUIT_FAILURE_THRESHOLD');
            // Apply same sequence twice - should get same results
            for (let round = 0; round < 2; round++) {
                setPrivate(adapter, 'circuitBreakerState', 'CLOSED');
                setPrivate(adapter, 'consecutiveFailures', 0);
                for (let i = 0; i < threshold; i++) {
                    callPrivate(adapter, 'recordCircuitFailure');
                }
                assert.strictEqual(getPrivate(adapter, 'circuitBreakerState'), 'OPEN', `Round ${round + 1}: Should be OPEN`);
                assert.strictEqual(getPrivate(adapter, 'consecutiveFailures'), threshold, `Round ${round + 1}: Counter should be at threshold`);
            }
        });
        test('CLOSED is the initial state', function () {
            // Create a fresh adapter
            const freshOutput = vscode.window.createOutputChannel('Fresh Test');
            const workspaceRoot = path.join(__dirname, '../../../');
            const freshAdapter = new daemonBeadsAdapter_1.DaemonBeadsAdapter(workspaceRoot, freshOutput);
            assert.strictEqual(getPrivate(freshAdapter, 'circuitBreakerState'), 'CLOSED', 'Initial state should be CLOSED');
            assert.strictEqual(getPrivate(freshAdapter, 'consecutiveFailures'), 0, 'Initial failures should be 0');
            freshAdapter.dispose();
            freshOutput.dispose();
        });
    });
});
