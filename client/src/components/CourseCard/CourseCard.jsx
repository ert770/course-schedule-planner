const DAYS = ['', '一', '二', '三', '四', '五'];

export default function CourseCard({ course, onSelect, selected, showActions = true }) {
  const categoryBadge = {
    '必修': 'badge-required',
    '選修': 'badge-elective',
    '通識': 'badge-general',
  };

  return (
    <div
      className={`course-card ${selected ? 'selected' : ''}`}
      onClick={() => onSelect?.(course)}
      style={selected ? { borderColor: 'var(--accent-blue)', background: 'rgba(59, 130, 246, 0.08)' } : {}}
      id={`course-card-${course.id}`}
    >
      <div className="course-card-header">
        <div>
          <div className="course-card-title">{course.name}</div>
          <div className="course-card-code">{course.code}</div>
        </div>
        <span className={`badge ${categoryBadge[course.category] || 'badge-elective'}`}>
          {course.category}
        </span>
      </div>
      <div className="course-card-meta">
        <span className="course-card-meta-item">👤 {course.instructor}</span>
        <span className="course-card-meta-item">📚 {course.credits} 學分</span>
        <span className="course-card-meta-item">
          ⏰ 週{DAYS[course.dayOfWeek]} {course.startPeriod}-{course.endPeriod}節
        </span>
        <span className="course-card-meta-item">📍 {course.location}</span>
      </div>
      {course.description && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px', lineHeight: 1.5 }}>
          {course.description.length > 60 ? course.description.slice(0, 60) + '...' : course.description}
        </p>
      )}
    </div>
  );
}
