const API_BASE = 'http://localhost:3001/api';

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  try {
    const res = await fetch(url, config);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err.message === 'Failed to fetch') {
      throw new Error('無法連接到伺服器，請確認後端已啟動。');
    }
    throw err;
  }
}

// Auth API
export const authAPI = {
  login: (studentId, password) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ studentId, password }),
    }),
  getMe: (studentId) => request(`/auth/me?studentId=${studentId}`),
  updateWatchlist: (studentId, watchlist) =>
    request('/auth/update-watchlist', {
      method: 'POST',
      body: JSON.stringify({ studentId, watchlist }),
    }),
};

// Graduation API
export const graduationAPI = {
  get: (studentId) => request(`/graduation/${studentId}`),
};

// `userId` 不再有 `'default'` 預設值。
//
// 舊的預設值會讓未登入或身分讀取失敗的請求靜默落到一個共用假使用者，
// 偏好、聊天記憶與課表全部寫到同一份資料上。現在缺身分就直接拋錯，
// 由呼叫端負責在登入完成後才呼叫。
//
// **改這個函式時務必列出全部呼叫端**，包含共用元件（例如 `components/Chat/ChatPanel.jsx`）
// 而不只是 pages——漏掉共用元件會讓整個頁面的功能失效。
function requireUserId(userId, apiName) {
  if (userId === undefined || userId === null || userId === '' || userId === 'default') {
    throw new Error(`${apiName} 需要已登入的使用者身分`);
  }
  return userId;
}

// Chat API
export const chatAPI = {
  send: (message, userId) =>
    request('/chat', {
      method: 'POST',
      body: JSON.stringify({ userId: requireUserId(userId, 'chatAPI.send'), message }),
    }),
};

// Courses API
export const coursesAPI = {
  search: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== '') params.append(k, v);
    });
    return request(`/courses?${params}`);
  },
  getDetail: (id) => request(`/courses/${id}`),
  getDepartments: () => request('/courses/departments'),
  // 某系所某年級實際存在的班別（例如 資訊三甲）。必修不得換班，需指定班別。
  getClasses: (department, grade) => {
    const params = new URLSearchParams({ department });
    if (grade) params.append('grade', grade);
    return request(`/courses/classes?${params}`);
  },
  getInstructors: () => request('/courses/instructors'),
};

// Schedule API
export const scheduleAPI = {
  generate: (data) =>
    request('/schedule/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  validate: (courses) =>
    request('/schedule/validate', {
      method: 'POST',
      body: JSON.stringify({ courses }),
    }),
  save: (name, schedule, totalCredits, userId) =>
    request('/schedule/save', {
      method: 'POST',
      body: JSON.stringify({
        userId: requireUserId(userId, 'scheduleAPI.save'),
        name,
        schedule,
        totalCredits,
      }),
    }),
  getSaved: (userId) =>
    request(`/schedule/saved?userId=${encodeURIComponent(requireUserId(userId, 'scheduleAPI.getSaved'))}`),
};

// Profile API
export const profileAPI = {
  get: (userId) =>
    request(`/profile?userId=${encodeURIComponent(requireUserId(userId, 'profileAPI.get'))}`),
  update: (data, userId) =>
    request('/profile', {
      method: 'POST',
      body: JSON.stringify({ userId: requireUserId(userId, 'profileAPI.update'), ...data }),
    }),
  // 偏好標籤目錄。不帶身分——回傳的是標籤定義本身，不是任何人的資料。
  // 前端各頁不再自己寫死清單，避免像先前 Dashboard 那樣漏掉 `#不點名`。
  getPreferenceTags: () => request('/profile/preference-tags'),
};

// Reviews API
export const reviewsAPI = {
  getEasy: (limit = 10) => request(`/reviews/easy?limit=${limit}`),
  getByCourse: (courseId) => request(`/reviews/${courseId}`),
};
