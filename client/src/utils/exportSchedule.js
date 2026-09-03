import { toPng } from 'html-to-image';
import { formatCourseTime } from './courseTime';

export function exportToText(schedule) {
  if (!schedule || schedule.length === 0) return;
  const content = schedule
    .map(c => `${c.name} | ${c.instructor || '未定'} | ${formatCourseTime(c)} | ${c.location || ''}`)
    .join('\n');
  
  downloadBlob(new Blob([`我的預排課表\n\n${content}`], { type: 'text/plain;charset=utf-8' }), '預排課表.txt');
}

export function exportToIcs(schedule) {
  if (!schedule || schedule.length === 0) return;

  const dayMap = { 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA', 7: 'SU' };
  
  const periodTimes = {
    1: { start: '081000', end: '090000' },
    2: { start: '091000', end: '100000' },
    3: { start: '101000', end: '110000' },
    4: { start: '111000', end: '120000' },
    5: { start: '121000', end: '130000' },
    6: { start: '131000', end: '140000' },
    7: { start: '141000', end: '150000' },
    8: { start: '151000', end: '160000' },
    9: { start: '161000', end: '170000' },
    10: { start: '171000', end: '180000' },
    11: { start: '183000', end: '192000' },
    12: { start: '192500', end: '201500' },
    13: { start: '202000', end: '211000' },
    14: { start: '211500', end: '220500' },
  };

  let icsEvents = '';
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  schedule.forEach((course) => {
    const day = course.day || 1;
    const periods = course.periods || [1];
    const startPeriod = Math.min(...periods);
    const endPeriod = Math.max(...periods);
    
    const startTimeStr = periodTimes[startPeriod]?.start || '080000';
    const endTimeStr = periodTimes[endPeriod]?.end || '090000';
    const byDay = dayMap[day] || 'MO';

    icsEvents += `
BEGIN:VEVENT
UID:${course.id || Math.random()}@fcu-schedule
DTSTAMP:${now}
DTSTART;TZID=Asia/Taipei:20260907T${startTimeStr}
DTEND;TZID=Asia/Taipei:20260907T${endTimeStr}
RRULE:FREQ=WEEKLY;UNTIL=20270115T235959Z;BYDAY=${byDay}
SUMMARY:${course.name}
DESCRIPTION:授課教師: ${course.instructor || '未定'}\\n學分: ${course.credits || 0}
LOCATION:${course.location || '逢甲大學'}
END:VEVENT`;
  });

  const icsBody = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//FCU Schedule Planner//TW\nCALSCALE:GREGORIAN\nMETHOD:PUBLISH${icsEvents}\nEND:VCALENDAR`;
  downloadBlob(new Blob([icsBody], { type: 'text/calendar;charset=utf-8' }), '課表行事曆.ics');
}

export async function exportToImage(elementId = 'schedule-grid-container') {
  const node = document.getElementById(elementId);
  if (!node) return;
  
  try {
    const dataUrl = await toPng(node, { quality: 0.95, backgroundColor: '#ffffff' });
    const link = document.createElement('a');
    link.download = '我的課表.png';
    link.href = dataUrl;
    link.click();
  } catch (error) {
    console.error('匯出圖片失敗:', error);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}