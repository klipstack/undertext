import { KeyboardEvent, RefObject, useEffect, useRef } from "react";
import { CHECKS, CheckId, TRIMS, TrimId } from "../ai/tasks";
import { ReviewKind, useAllLabel } from "../editor/highlights";
import { EditorInfo } from "../editor/setup";
import { Icon } from "./Icon";
import { RightTab } from "./panels";

interface Props {
  tab: RightTab;
  panelRef: RefObject<HTMLElement | null>;
  overflow: string;
  busy: string | null;
  /** Live highlights. Null until Review turns them on. */
  checks: EditorInfo["checks"];
  words: number;
  hidden: readonly ReviewKind[];
  onToggle(kinds: readonly ReviewKind[]): void;
  onJump(kinds: readonly ReviewKind[]): void;
  /** Asks Claude for writing issues. */
  onFindIssues(): void;
  /** Uses the fix of the mark at the caret. */
  onUseFix(): void;
  /** Uses every writing issue's fix that fits. */
  onUseAll(): void;
  onTab(tab: RightTab): void;
  onOverflow(text: string): void;
  onCheck(id: CheckId): void;
  onTrim(id: TrimId): void;
  onCancel(): void;
  /** Esc: back to the page. The panel stays open. */
  onPage(): void;
}

/**
 * The right panel, about the whole page: Review (readability, highlights, AI checks, trims) and
 * Overflow, one tab at a time. The element marked `data-focus` takes the focus when the tab opens from its key.
 */
export function RightPanel(props: Props) {
  const { tab } = props;
  return (
    <aside className="side side-right" aria-label={tab === "review" ? "Review" : "Overflow"} ref={props.panelRef}>
      <nav className="tabs">
        <button className={tab === "review" ? "on" : ""} onClick={() => props.onTab("review")} title="Review (⌘⇧E)">
          Review
        </button>
        <button className={tab === "overflow" ? "on" : ""} onClick={() => props.onTab("overflow")} title="Overflow (⌘⇧O)">
          Overflow
        </button>
      </nav>
      {tab === "review" ? <Review {...props} /> : <Overflow {...props} />}
    </aside>
  );
}

/** Arrow keys move, Return runs, Esc cancels a run or goes back to the page. */
function Review(props: Props) {
  const { busy, onFindIssues, onCheck, onTrim, onCancel, onPage } = props;
  const ref = useRef<HTMLDivElement>(null);

  // A run replaces the buttons, and its end removes the spinner. Keep the focus in the panel then,
  // so Esc still cancels.
  useEffect(() => {
    const lost = document.activeElement === document.body || ref.current?.contains(document.activeElement);
    if (lost) ref.current?.querySelector<HTMLElement>("[data-focus]")?.focus();
  }, [busy]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (busy) onCancel();
      else onPage();
      return;
    }
    // The eye toggles are a Tab away, so the arrows walk the rows and the actions.
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(.hl-eye):not(:disabled)") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const delta = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!delta || !buttons.length) return;
    e.preventDefault();
    const next = i < 0 ? (delta > 0 ? 0 : buttons.length - 1) : (i + delta + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  return (
    <>
      <div className="side-body review" ref={ref} onKeyDown={onKeyDown}>
        <Readability {...props} />
        <h3 className="review-label">Run a check</h3>
        {busy ? (
          <p className="lab-busy" tabIndex={-1} aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            {busy}…
          </p>
        ) : (
          <>
            <button className="lab-item" onClick={onFindIssues}>
              Find writing issues
            </button>
            {CHECKS.map((c) => (
              <button key={c.id} className="lab-item" onClick={() => onCheck(c.id)}>
                {c.title}
                {!c.ai && <span className="lab-note">instant</span>}
              </button>
            ))}
            <div className="lab-trims" role="group" aria-label="Trim">
              {TRIMS.map((t) => (
                <button key={t.id} className="lab-trim" onClick={() => onTrim(t.id)}>
                  {t.label}
                  <span>−{t.percent}%</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <footer className="side-hint">{busy ? "esc cancels" : "↑↓ choose · return runs · esc back to the page"}</footer>
    </>
  );
}

const WEAKENERS: { kind: ReviewKind; one: string; many: string }[] = [
  { kind: "adverb", one: "adverb", many: "adverbs" },
  { kind: "passive", one: "use of passive voice", many: "uses of passive voice" },
  { kind: "qualifier", one: "qualifier", many: "qualifiers" },
  { kind: "intensifier", one: "intensifier", many: "intensifiers" },
  { kind: "weakVerb", one: "weak verb", many: "weak verbs" },
  { kind: "filler", one: "filler", many: "fillers" },
  { kind: "hidden", one: "hidden action", many: "hidden actions" },
  { kind: "negative", one: "negative", many: "negatives" },
  { kind: "redundant", one: "redundant pair", many: "redundant pairs" },
  { kind: "cliche", one: "cliché", many: "clichés" },
];

/**
 * The grade, then one row per kind of highlight: its count, a click to the next one, and an eye.
 * It takes the focus when Review opens from its key, before the first count arrives.
 */
function Readability({ checks, words, hidden, onToggle, onJump, onUseFix, onUseAll }: Props) {
  if (!checks) return <div className="readability" tabIndex={-1} data-focus />;
  const { counts, sentences: total } = checks;
  const sentences = (n: number, what: string) =>
    `of ${total} ${total === 1 ? "sentence" : "sentences"} ${n === 1 ? "is" : "are"} ${what}`;
  const weak = WEAKENERS.map((w) => w.kind);
  const weakCount = checks.weakeners;
  const row = (kinds: readonly ReviewKind[], tone: string, count: number, label: string, sub = false) => {
    const off = kinds.every((k) => hidden.includes(k));
    return (
      <div className={`hl-row${sub ? " sub" : ""}${off ? " off" : ""}`} key={kinds.join()}>
        <button className="hl-jump" disabled={!count} onClick={() => onJump(kinds)} title="Go to the next one">
          <span className={`hl-count hl-${tone}`}>{count}</span>
          {label}
        </button>
        <button
          className="hl-eye"
          onClick={() => onToggle(kinds)}
          aria-label="Show on the page"
          aria-pressed={!off}
          title={off ? "Show them" : "Hide them"}
        >
          <Icon name={off ? "eyeOff" : "eye"} />
        </button>
      </div>
    );
  };
  return (
    <>
      <div className="readability" tabIndex={-1} data-focus>
        <div className="grade">{checks.grade === null ? "No sentences yet" : `Grade ${checks.grade}`}</div>
        <div className="grade-sub">
          {words} {words === 1 ? "word" : "words"} · {total} {total === 1 ? "sentence" : "sentences"}
          {words > 0 && ` · ${Math.max(1, Math.round(words / 250))} min`}
        </div>
        <p className="hl-here" aria-live="polite">
          {checks.here ?? "Click a highlight to see why it's marked."}
          {checks.fix && (
            <button className="hl-fix" onClick={onUseFix} title={checks.fixHint ?? undefined}>
              Use “{checks.fix}”
            </button>
          )}
        </p>
      </div>
      {row(["veryHard"], "veryHard", counts.veryHard, sentences(counts.veryHard, "very hard to read"))}
      {row(["hard"], "hard", counts.hard, sentences(counts.hard, "hard to read"))}
      {row(weak, "weak", weakCount, weakCount === 1 ? "weakener" : "weakeners")}
      {WEAKENERS.map((w) => row([w.kind], "weak", counts[w.kind], counts[w.kind] === 1 ? w.one : w.many, true))}
      {row(
        ["simpler"],
        "simpler",
        counts.simpler,
        counts.simpler === 1 ? "word with a simpler alternative" : "words with a simpler alternative",
      )}
      {row(["dash", "dashStyle"], "dash", counts.dash + counts.dashStyle, counts.dash + counts.dashStyle === 1 ? "dash to check" : "dashes to check")}
      {checks.ran && row(["grammar"], "grammar", counts.grammar, counts.grammar === 1 ? "writing issue" : "writing issues")}
      {checks.fixAll > 0 && (
        <button className="hl-fix hl-fix-all" onClick={onUseAll} title="Uses every fix that fits. ⌘Z brings your words back.">
          {useAllLabel(checks.fixAll)}
        </button>
      )}
    </>
  );
}

function Overflow({ overflow, onOverflow, onPage }: Props) {
  return (
    <>
      <textarea
        className="overflow"
        data-focus
        value={overflow}
        onChange={(e) => onOverflow(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onPage();
          }
        }}
        placeholder="Extra writing, notes, leftovers…"
        spellCheck
      />
      <footer className="side-hint">⌘⇧X stashes selection · esc back to the page · ⌘⇧O closes</footer>
    </>
  );
}
