// 本次規劃的避開清單。
//
// **這一列不可省略**：不顯示就等於系統默默套用了使用者看不見的排課條件——
// 使用者只會發現課表少了東西卻找不到原因，那跟這次要修的原始症狀（移除後
// 又被排回來、畫面上沒有解釋）是同一種毛病的反面。
const SCOPE_TEXT = {
  section: '只避開這個班次',
  catalog_course: '避開整門課',
  instructor: '避開這位教師',
};

const REASON_TEXT = {
  time: '時段不合',
  content: '內容不感興趣',
  instructor: '教師因素',
  workload: '負擔太重',
  full: '人數已滿',
  eligibility: '不符資格',
  other: '其他原因',
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
    <div className="session-avoidance-bar" role="status">
      <div className="session-avoidance-main">
        <strong>本次重排會避開：</strong>
        <span>{applied.map(describe).join('、') || '（目前沒有生效的避開條件）'}</span>
      </div>

      {pending.length > 0 && (
        <p className="session-avoidance-pending">
          {pending.map(entry => entry.courseName || `班次 ${entry.sectionId}`).join('、')}
          還沒說明移除原因，目前只避開該班次。在聊天中說明原因後，可以改成避開整門課或該教師。
        </p>
      )}

      {conflicts.map(entry => (
        <p className="session-avoidance-conflict" key={entry.sectionId}>
          未套用：{entry.courseName || `班次 ${entry.sectionId}`}
          {entry.statusMessage ? `——${entry.statusMessage}` : '為必修，仍保留在課表中。請決定要保留必修，還是取消這項避開條件。'}
        </p>
      ))}

      <button type="button" className="action-btn secondary" onClick={onClear}>
        清除本次避開
      </button>
    </div>
  );
}
