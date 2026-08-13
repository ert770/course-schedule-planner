import { useMemo, Fragment } from 'react';
import { DAYS as DAY_DEFS, PERIODS } from '../../constants/periods';

// 資料庫含週六與週日課程，只畫五天會讓那些課程在畫面上消失，
// 造成學分數與課表格內容對不起來。
//
// 節次與星期的對照改由 `constants/periods.js` 提供——這份原本在這裡、
// 時段選擇器與後端各有一份，三份各自維護必然有一天對不上。
const DAYS = ['', ...DAY_DEFS.map(day => day.label)];
const DAY_NUMBERS = DAY_DEFS.map(day => day.value);

const COURSE_COLORS = [
  '#4a7cf7', '#6b93f7', '#5b8af5', '#7ba3f9',
  '#4a7cf7', '#6b93f7', '#5b8af5', '#7ba3f9',
  '#4a7cf7', '#6b93f7',
];

export default function ScheduleGrid({ courses = [], onCourseClick }) {
  const colorMap = useMemo(() => {
    const map = {};
    const uniqueCourses = [...new Set(courses.map(c => c.id))];
    uniqueCourses.forEach((id, i) => {
      map[id] = COURSE_COLORS[i % COURSE_COLORS.length];
    });
    return map;
  }, [courses]);

  const gridData = useMemo(() => {
    const data = {};
    courses.forEach(course => {
      // 一門課可能有多個時段，逐段渲染，只畫第一段會讓其餘時段從課表上消失。
      const blocks = Array.isArray(course.timeBlocks) && course.timeBlocks.length > 0
        ? course.timeBlocks
        : [{
          dayOfWeek: course.dayOfWeek,
          startPeriod: course.startPeriod,
          endPeriod: course.endPeriod,
        }];

      blocks.forEach(block => {
        if (block.dayOfWeek == null || block.startPeriod == null) return;
        const endPeriod = block.endPeriod ?? block.startPeriod;
        for (let p = block.startPeriod; p <= endPeriod; p += 1) {
          data[`${block.dayOfWeek}-${p}`] = {
            course,
            isStart: p === block.startPeriod,
            span: endPeriod - block.startPeriod + 1,
          };
        }
      });
    });
    return data;
  }, [courses]);

  return (
    <div className="schedule-grid" id="schedule-grid">
      {/* Header row */}
      <div className="schedule-header corner"></div>
      {DAY_NUMBERS.map(day => (
        <div key={day} className="schedule-header day">
          {DAYS[day]}
        </div>
      ))}

      {/* Time slots */}
      {PERIODS.map(period => (
        <Fragment key={`period-${period.num}`}>
          <div className="time-label">
            <span className="period-num">{period.num}</span>
            <span>{period.start}</span>
          </div>
          {DAY_NUMBERS.map(day => {
            const key = `${day}-${period.num}`;
            const slot = gridData[key];

            if (slot && slot.isStart) {
              return (
                <div key={key} className="time-slot occupied">
                  <div
                    className="course-block"
                    style={{
                      background: colorMap[slot.course.id],
                      height: `${slot.span * 48 + (slot.span - 1)}px`,
                    }}
                    onClick={() => onCourseClick?.(slot.course)}
                    title={`${slot.course.name}\n${slot.course.instructor}\n${slot.course.location}`}
                  >
                    <span className="course-name">{slot.course.name}</span>
                    <span className="course-info">({slot.course.instructor})</span>
                    <span className="course-info">{slot.course.location}</span>
                  </div>
                </div>
              );
            }

            if (slot && !slot.isStart) {
              return <div key={key} className="time-slot occupied" />;
            }

            return <div key={key} className="time-slot" />;
          })}
        </Fragment>
      ))}
    </div>
  );
}
