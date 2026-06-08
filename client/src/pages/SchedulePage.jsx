import { useState, useEffect } from 'react';
import { Sparkles, BookOpen, Download } from 'lucide-react';
import ScheduleGrid from '../components/Schedule/ScheduleGrid';
import ChatPanel from '../components/Chat/ChatPanel';
import CourseCard from '../components/CourseCard/CourseCard';
import { coursesAPI, scheduleAPI } from '../services/api';

export default function SchedulePage() {
  const [schedule, setSchedule] = useState([]);
  const [courses, setCourses] = useState([]);
  const [selectedCourses, setSelectedCourses] = useState([]);
  const [showCourses, setShowCourses] = useState(false);
  const [filters, setFilters] = useState({ keyword: '', category: '', department: '' });
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detailCourse, setDetailCourse] = useState(null);

  useEffect(() => {
    loadDepartments();
  }, []);

  const loadDepartments = async () => {
    try {
      const data = await coursesAPI.getDepartments();
      setDepartments(data.departments || []);
    } catch (err) {
      console.error('Failed to load departments:', err);
    }
  };

  const searchCourses = async () => {
    setLoading(true);
    try {
      const data = await coursesAPI.search(filters);
      setCourses(data.courses || []);
      setShowCourses(true);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleCourseSelection = (course) => {
    setSelectedCourses(prev => {
      const exists = prev.find(c => c.id === course.id);
      if (exists) return prev.filter(c => c.id !== course.id);
      return [...prev, course];
    });
  };

  const generateSchedule = async () => {
    setLoading(true);
    try {
      const courseIds = selectedCourses.length > 0
        ? selectedCourses.map(c => c.id)
        : [];

      const data = await scheduleAPI.generate({
        courseIds,
        constraints: {},
      });

      if (data.success) {
        setSchedule(data.schedule);
        setShowCourses(false);
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert('排課失敗：' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleScheduleFromChat = (newSchedule) => {
    setSchedule(newSchedule);
    setShowCourses(false);
  };

  const totalCredits = schedule.reduce((s, c) => s + c.credits, 0);

  return (
    <div className="schedule-page" id="schedule-page">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
        {/* Controls */}
        <div className="schedule-controls">
          <div className="schedule-stats">
            <div className="stat-item">
              <span className="stat-icon">📚</span>
              <span className="stat-value">{schedule.length}</span> 門課
            </div>
            <div className="stat-item">
              <span className="stat-icon">🎓</span>
              <span className="stat-value">{totalCredits}</span> 學分
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn-secondary"
              onClick={() => setShowCourses(!showCourses)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              id="toggle-courses-btn"
            >
              <BookOpen size={16} />
              {showCourses ? '隱藏課程' : '瀏覽課程'}
            </button>
            <button
              className="btn-primary"
              onClick={generateSchedule}
              disabled={loading}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              id="generate-btn"
            >
              <Sparkles size={16} />
              {loading ? '排課中...' : '自動排課'}
            </button>
          </div>
        </div>

        {/* Course browser */}
        {showCourses && (
          <div className="animate-fadeInUp" style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
            padding: '16px',
            maxHeight: '300px',
            overflow: 'auto',
          }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <input
                className="input-field"
                placeholder="搜尋課程名稱..."
                value={filters.keyword}
                onChange={(e) => setFilters(f => ({ ...f, keyword: e.target.value }))}
                style={{ flex: 1, minWidth: '150px' }}
                id="course-search-input"
              />
              <select
                className="input-field"
                value={filters.department}
                onChange={(e) => setFilters(f => ({ ...f, department: e.target.value }))}
                style={{ width: '160px' }}
                id="department-select"
              >
                <option value="">所有系所</option>
                {departments.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <select
                className="input-field"
                value={filters.category}
                onChange={(e) => setFilters(f => ({ ...f, category: e.target.value }))}
                style={{ width: '100px' }}
                id="category-select"
              >
                <option value="">所有類別</option>
                <option value="必修">必修</option>
                <option value="選修">選修</option>
                <option value="通識">通識</option>
              </select>
              <button className="btn-primary" onClick={searchCourses} id="search-btn">搜尋</button>
            </div>

            {selectedCourses.length > 0 && (
              <div style={{
                fontSize: '0.8rem', color: 'var(--accent-emerald)',
                marginBottom: '8px', padding: '6px 12px',
                background: 'rgba(16, 185, 129, 0.1)', borderRadius: 'var(--radius-sm)'
              }}>
                已選 {selectedCourses.length} 門課（點擊「自動排課」使用已選課程排課）
              </div>
            )}

            <div style={{ display: 'grid', gap: '8px' }}>
              {courses.map(course => (
                <CourseCard
                  key={course.id}
                  course={course}
                  onSelect={toggleCourseSelection}
                  selected={selectedCourses.some(c => c.id === course.id)}
                />
              ))}
              {courses.length === 0 && (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                  點擊搜尋瀏覽課程，或在右側對話框輸入需求
                </div>
              )}
            </div>
          </div>
        )}

        {/* Schedule Grid */}
        <div className="schedule-container" style={{ flex: 1, overflow: 'auto' }}>
          <ScheduleGrid
            courses={schedule}
            onCourseClick={setDetailCourse}
          />
        </div>
      </div>

      {/* Chat Panel */}
      <ChatPanel onScheduleGenerated={handleScheduleFromChat} />

      {/* Course Detail Modal */}
      {detailCourse && (
        <div className="modal-overlay" onClick={() => setDetailCourse(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setDetailCourse(null)}>✕</button>
            <h2 style={{ fontSize: '1.3rem', marginBottom: '8px' }}>{detailCourse.name}</h2>
            <span className="course-card-code" style={{ fontSize: '0.85rem' }}>{detailCourse.code}</span>

            <div style={{ display: 'grid', gap: '12px', marginTop: '20px' }}>
              <div className="course-card-meta" style={{ fontSize: '0.9rem' }}>
                <span className="course-card-meta-item">👤 {detailCourse.instructor}</span>
                <span className="course-card-meta-item">📚 {detailCourse.credits} 學分</span>
                <span className="course-card-meta-item">📍 {detailCourse.location}</span>
                <span className="course-card-meta-item">
                  ⏰ 週{['','一','二','三','四','五'][detailCourse.dayOfWeek]} 第{detailCourse.startPeriod}-{detailCourse.endPeriod}節
                </span>
              </div>

              {detailCourse.description && (
                <div style={{ padding: '12px', background: 'var(--bg-glass-light)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>課程說明</div>
                  <p style={{ fontSize: '0.9rem', lineHeight: 1.6 }}>{detailCourse.description}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
