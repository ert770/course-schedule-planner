const SCOPE_TEXT = {
  section: '只避開這個班次',
  catalog_course: '避開整門課',
  instructor: '避開這位教師',
};

function describe(entry) {
  const name = entry.courseName || `班次 ${entry.sectionId}`;
  if (entry.scope === 'instructor' && entry.instructor) {
    return `${entry.instructor}老師的班次`;
  }
  return `${name}（${SCOPE_TEXT[entry.scope] ?? SCOPE_TEXT.section}）`;
}

export default function SessionAvoidanceBar({ avoidances = [], onClear }) {
  if (!Array.isArray(avoidances) || avoidances.length === 0) return null;

  // `status` 不是 `applied` 的項目**不得**顯示成「已避開」。必修衝突時那門課
  // 其實還在課表上，說成已避開就是畫面跟課表自相矛盾。
  const conflicts = avoidances.filter(entry => entry.status === 'protected-conflict');
  const pending = avoidances.filter(entry => entry.pendingReason);
  const applied = avoidances.filter(entry => entry.status !== 'protected-conflict');

  return (
    <div className="schedule-temporary-avoidance">
      <button type="button" className="schedule-plan-button" popoverTarget="session-avoidance-popover">
        暫時避開（{avoidances.length}）
      </button>
      <section id="session-avoidance-popover" className="schedule-plan-popover schedule-avoidance-popover"
        popover="auto" aria-labelledby="session-avoidance-title">
        <h3 id="session-avoidance-title">暫時避開</h3>
        {applied.length > 0 ? (
          <ul>{applied.map(entry => <li key={entry.sectionId}>{describe(entry)}</li>)}</ul>
        ) : <p>目前沒有生效的暫時避開條件。</p>}

        {pending.length > 0 && (
          <p>
            {pending.map(entry => entry.courseName || `班次 ${entry.sectionId}`).join('、')}
            還沒說明移除原因，目前只避開該班次。在聊天中說明原因後，可以改成避開整門課或該教師。
          </p>
        )}

        {conflicts.map(entry => (
          <p className="session-avoidance-conflict" key={entry.sectionId}>
            未套用：{entry.courseName || `班次 ${entry.sectionId}`}
            {entry.statusMessage ? `，${entry.statusMessage}` : '為必修，仍保留在課表中。'}
          </p>
        ))}

        <button type="button" className="action-btn secondary" onClick={onClear}>
          清除本次避開
        </button>
      </section>
    </div>
  );
}
