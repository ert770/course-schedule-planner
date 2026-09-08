const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  };

  try {
    const res = await fetch(url, config);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      if (res.status === 401 && endpoint !== '/auth/login' && endpoint !== '/auth/me') {
        localStorage.removeItem('fcu_user');
        if (window.location.pathname !== '/login') window.location.assign('/login');
      }
      const error = new Error(err.error || `HTTP ${res.status}`);
      error.status = res.status;
      error.code = err.code;
      throw error;
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
  getMe: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST', keepalive: true }),
  updateWatchlist: (watchlist) =>
    request('/auth/update-watchlist', {
      method: 'POST',
      body: JSON.stringify({ watchlist }),
    }),
};

// Graduation API
export const graduationAPI = { get: () => request('/graduation/me') };

// Chat API
export const chatAPI = {
  send: (message) =>
    request('/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
};

// Privacy API。server consent 是唯一真相來源；localStorage 不代表法律同意。
export const privacyAPI = {
  getPolicy: () => request('/privacy/policy'),
  getConsents: () => request('/privacy/consents'),
  updateConsents: (consents) => request('/privacy/consents', {
    method: 'PUT',
    body: JSON.stringify({ consents }),
  }),
  exportData: () => request('/privacy/export'),
  clearChat: () => request('/privacy/chat', { method: 'DELETE' }),
  createDeletionIntent: () => request('/privacy/deletion-intents', { method: 'POST' }),
  deleteData: (payload) => request('/privacy/data', {
    method: 'DELETE',
    body: JSON.stringify(payload),
  }),
  // roadmap #31：個人化現況（顯式／學習／資料不足／未同意）。
  // 這支 GET 在結果過期時會順手重算並寫回一列——它是快取填充，不是新的
  // 寫入語意，但呼叫端不該假設這是一支保證唯讀的 GET。
  getPersonalization: () => request('/privacy/personalization'),
  // roadmap #31：只清學習結果與其輸入的互動事件，顯式 Profile（偏好標籤、
  // 避開時段、學分上限）不受影響。
  resetPersonalization: () => request('/privacy/personalization', { method: 'DELETE' }),
};

// Interaction log API（roadmap #2）。
// 未同意 personalization_learning 時後端回 200 + recorded:false，不是錯誤——
// 這是可選用途，預設關閉是合法狀態，不該把使用者推到同意牆。
export const interactionsAPI = {
  record: (events) => request('/interactions', {
    method: 'POST',
    body: JSON.stringify({ events }),
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
  save: (name, schedule, totalCredits) =>
    request('/schedule/save', {
      method: 'POST',
      body: JSON.stringify({
        name,
        schedule,
        totalCredits,
      }),
    }),
  getSaved: () => request('/schedule/saved'),
  // roadmap #27：counterfactual——只在使用者展開比較面板時才呼叫，
  // 不併入 `generate`（見 `scheduleService.counterfactualForUser()` 的效能說明）。
  counterfactual: (data) =>
    request('/schedule/counterfactual', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// Profile API
export const profileAPI = {
  get: () => request('/profile'),
  update: (data) =>
    request('/profile', {
      method: 'POST',
      body: JSON.stringify(data),
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
