import { useState } from 'react';
import { EXAMPLE_GROUPS, FEATURED_EXAMPLES, fillExample } from '../../data/agentExamples';

// compact：已經有對話紀錄時，只留一行「查看範例」，不擋對話。
export default function AgentExamples({ schedule, onPick, compact = false }) {
  const [open, setOpen] = useState(false);

  const chip = text => {
    const filled = fillExample(text, schedule);
    return (
      <button type="button" key={text} className="agent-example-chip" onClick={() => onPick(filled)}>
        {filled}
      </button>
    );
  };

  return (
    <div className={`agent-examples ${compact ? 'agent-examples-compact' : ''}`}>
      {!compact && <div className="agent-example-row">{FEATURED_EXAMPLES.map(chip)}</div>}
      <button type="button" className="agent-example-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {open ? '▾' : '▸'} {compact ? '查看範例' : '查看更多範例'}
      </button>
      {open && (
        <div className="agent-example-groups">
          {EXAMPLE_GROUPS.map(group => (
            <section key={group.title}>
              <h4>{group.title}</h4>
              <div className="agent-example-row">{group.items.map(chip)}</div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
