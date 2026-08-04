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

// Chat API
export const chatAPI = {
  send: (message, userId = 'default') =>
    request('/chat', {
      method: 'POST',
      body: JSON.stringify({ userId, message }),
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
  save: (name, schedule, totalCredits, userId = 'default') =>
    request('/schedule/save', {
      method: 'POST',
      body: JSON.stringify({ userId, name, schedule, totalCredits }),
    }),
  getSaved: (userId = 'default') =>
    request(`/schedule/saved?userId=${userId}`),
};

// Profile API
export const profileAPI = {
  get: (userId = 'default') => request(`/profile?userId=${userId}`),
  update: (data, userId = 'default') =>
    request('/profile', {
      method: 'POST',
      body: JSON.stringify({ userId, ...data }),
    }),
};

// Reviews API
export const reviewsAPI = {
  getEasy: (limit = 10) => request(`/reviews/easy?limit=${limit}`),
  getByCourse: (courseId) => request(`/reviews/${courseId}`),
};
