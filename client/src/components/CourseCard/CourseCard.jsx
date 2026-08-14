import { formatCourseTime } from '../../utils/courseTime';

export default function CourseCard({ course, onSelect, selected }) {
  const categoryBadge = {
    '必修': 'badge-required',
    '核心選修': 'badge-elective',
    '一般選修': 'badge-elective',
    '系外選修': 'badge-general',
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
        {course.category === '通識' && (
          <span className="course-card-meta-item">
            🧭 {course.generalEducationDomain || '不分領域'}
          </span>
        )}
        <span className="course-card-meta-item">
          ⏰ {formatCourseTime(course)}
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
