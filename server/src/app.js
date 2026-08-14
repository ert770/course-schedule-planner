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
