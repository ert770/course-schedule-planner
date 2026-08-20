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
