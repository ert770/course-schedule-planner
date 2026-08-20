import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import chatRoutes from './routes/chat.js';
import courseRoutes from './routes/courses.js';
import scheduleRoutes from './routes/schedule.js';
import profileRoutes from './routes/profile.js';
import reviewRoutes from './routes/reviews.js';
import authRoutes from './routes/auth.js';
import graduationRoutes from './routes/graduation.js';
import { assertSessionSecretConfigured } from './services/sessionService.js';

dotenv.config({ quiet: true });
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

export const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/graduation', graduationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/reviews', reviewRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export function startServer(port = PORT) {
  // 生產環境沒有固定、所有 replica 共用的 SESSION_SECRET 時直接拒絕啟動，
  // 而不是安靜地退回每個 process 各自產生的暫時密鑰——後者會讓重啟後所有
  // 登入 session 失效，多台 replica 之間也互相拒絕彼此簽的 cookie，而且
  // 症狀是隨機、難以重現的認證失敗，不是一個清楚可診斷的啟動錯誤。
  assertSessionSecretConfigured();

  return app.listen(port, () => {
    console.log(`\n🚀 課表規劃推薦系統後端已啟動`);
    console.log(`   http://localhost:${port}`);
    console.log(`   API: http://localhost:${port}/api\n`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer();
}

export default app;
