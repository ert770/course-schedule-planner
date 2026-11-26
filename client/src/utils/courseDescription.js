export function withoutRepeatedCourseTitle(description, courseName) {
  const body = typeof description === 'string' ? description.trim() : '';
  const name = typeof courseName === 'string' ? courseName.trim() : '';
  if (!name) return body;
  const titleLine = /^課程\s*[：:]\s*([^。！？\r\n]+)(?:[。！？]|\r?\n|$)/u.exec(body);
  return titleLine?.[1].trim() === name ? body.slice(titleLine[0].length).trim() : body;
}
