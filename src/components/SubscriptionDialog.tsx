import { useEffect, useRef, useState } from "react";
import { ClaudeCodeStatus, claudeCodeSetEnabled, claudeCodeStatus } from "../ai/client";

interface Props {
  /** An API key is saved, so requests use it instead of the subscription. */
  hasKey: boolean;
  message?: string;
  onEnabled(): void;
  onDisabled(): void;
  onUseKey(): void;
  onClose(): void;
}

const errorText = (err: unknown) => String(err).replace(/^\w+: /, "");

const NOT_INSTALLED: ClaudeCodeStatus = { installed: false, connected: false, enabled: false, plan: null };

/**
 * Lets the person run AI features on their Claude subscription through Claude Code.
 * Undertext never signs anyone in; it only uses a Claude Code login once the person opts in.
 */
export function SubscriptionDialog({ hasKey, message, onEnabled, onDisabled, onUseKey, onClose }: Props) {
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const check = () => {
    setError(null);
    claudeCodeStatus()
      .then(setStatus)
      .catch(() => setStatus(NOT_INSTALLED));
  };

  useEffect(() => {
    dialogRef.current?.focus();
    check();
  }, []);

  const setEnabled = async (enabled: boolean) => {
    setError(null);
    try {
      await claudeCodeSetEnabled(enabled);
      if (enabled) onEnabled();
      else onDisabled();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const inUse = status?.connected && status.enabled;
  const plan = status?.plan ? ` (${status.plan[0].toUpperCase()}${status.plan.slice(1)} plan)` : "";

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="dialog"
        role="dialog"
        aria-label="Claude subscription"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <h2>Claude subscription</h2>
        {message && !inUse && <p className="dialog-alert">{message}</p>}

        {!status && <p>Checking Claude Code…</p>}

        {status && !status.installed && (
          <p>
            The Lab and AI alternatives can run on your Claude subscription through Claude Code. Install it from
            claude.com/code and sign in, then check again. Or use an API key instead.
          </p>
        )}

        {status?.installed && !status.connected && (
          <p>
            The Lab and AI alternatives can run on your Claude subscription through Claude Code. Run <code>claude</code>{" "}
            in a terminal and sign in with your Claude account, then check again.
          </p>
        )}

        {status?.connected && !status.enabled && (
          <p>
            Claude Code is signed in{plan}. Use it for the Lab and AI alternatives? Each request sends your document to
            Claude and counts against your plan's usage limits.
          </p>
        )}

        {inUse && (
          <p>
            AI features use your Claude subscription through Claude Code{plan}. Requests count against your plan's usage
            limits.
          </p>
        )}

        {status && hasKey && <p>An API key is saved, so AI requests use the key. Remove it to use your subscription.</p>}

        {error && <p className="dialog-alert">{error}</p>}

        <div className="dialog-actions">
          {inUse && (
            <button type="button" className="danger" onClick={() => void setEnabled(false)}>
              Stop using subscription
            </button>
          )}
          {status && !inUse && (
            <button type="button" onClick={onUseKey}>
              {hasKey ? "Manage API key" : "Use an API key"}
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            {inUse ? "Done" : "Cancel"}
          </button>
          {status && !status.connected && (
            <button type="button" className="primary" onClick={check}>
              Check again
            </button>
          )}
          {status?.connected && !status.enabled && (
            <button type="button" className="primary" onClick={() => void setEnabled(true)}>
              Use my subscription
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
